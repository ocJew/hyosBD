// =================================================================
// 1. CONFIGURAÇÃO INICIAL E VARIÁVEIS GLOBAIS
// =================================================================
const firebaseConfig = {
    // ATENÇÃO: SUBSTITUA COM SUAS CHAVES REAIS DO FIREBASE
    apiKey: "AIzaSyDKBTU8zUwcI5wQF6r0J1xIowXIpvMuDM", 
    authDomain: "hyosbd-60588.firebaseapp.com",
    projectId: "hyosbd-60588",
    storageBucket: "hyosbd-60588.firebasestorage.app",
    messagingSenderId: "990090695311",
    appId: "1:990090695311:web:60e973f2c44383df3f96fa",
    measurementId: "G-BSZMZ0088Y"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const videosCollection = db.collection("videos");

// Elementos
const videoModal = document.getElementById('videoModal');
const closeModalButton = document.getElementById('closeModal');
const openAddModalButton = document.getElementById('openAddModal');
const addButton = document.getElementById('addButton');
const message = document.getElementById('message');
const videoList = document.getElementById('videoList');
const tagSelector = document.getElementById('tagSelector');
const activeFiltersContainer = document.getElementById('activeFilters');
// NOVOS ELEMENTOS
const filterContainer = document.getElementById('filterContainer');
const toggleFilterButton = document.getElementById('toggleFilter');

let activeTags = []; // Tags atualmente sendo usadas para filtrar (Chips)
let allAvailableTags = new Set(); // Todas as tags encontradas nos vídeos (Dropdown)

// =================================================================
// 2. FUNÇÕES DO MODAL (ADICIONAR/EDITAR)
// =================================================================

function openModal(isEdit = false, docId = null, data = {}) {
    // Preenchimento do formulário
    document.getElementById('url').value = data.url || '';
    document.getElementById('titulo').value = data.titulo || '';
    document.getElementById('tags').value = Array.isArray(data.tags) ? data.tags.join(', ') : '';
    document.getElementById('descricao').value = data.descricao || '';
    message.textContent = ''; // Limpa mensagem

    if (isEdit) {
        document.getElementById('modalTitle').textContent = `Editar Vídeo: ${data.titulo}`;
        addButton.textContent = 'Salvar Edição';
        addButton.dataset.editId = docId;
    } else {
        document.getElementById('modalTitle').textContent = 'Adicionar Novo Vídeo';
        addButton.textContent = 'Adicionar ao Catálogo';
        delete addButton.dataset.editId;
    }

    videoModal.style.display = 'block';
}

function closeAndResetModal() {
    videoModal.style.display = 'none';
    // Limpeza completa do formulário
    document.getElementById('url').value = '';
    document.getElementById('titulo').value = '';
    document.getElementById('tags').value = '';
    document.getElementById('descricao').value = '';
    message.textContent = '';
    delete addButton.dataset.editId;
}

// Event Listeners do Modal
openAddModalButton.addEventListener('click', () => openModal(false));
closeModalButton.addEventListener('click', closeAndResetModal);
window.addEventListener('click', (event) => {
    if (event.target === videoModal) closeAndResetModal();
});

// Event Listener para Adicionar/Editar
addButton.addEventListener('click', async () => {
    const docId = addButton.dataset.editId;
    const url = document.getElementById('url').value;
    const titulo = document.getElementById('titulo').value;
    const tagsInput = document.getElementById('tags').value;
    const descricao = document.getElementById('descricao').value;

    if (!url || !titulo || !tagsInput) {
        message.textContent = 'Erro: URL, Título e Tags são obrigatórios!';
        message.style.color = 'red';
        return;
    }

    const tagsArray = tagsInput.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 0);
    const videoData = { url, titulo, descricao, tags: tagsArray };

    try {
        if (docId) {
            // MODO EDIÇÃO
            await videosCollection.doc(docId).update(videoData);
            message.textContent = `Vídeo "${titulo}" editado com sucesso!`;
        } else {
            // MODO ADICIONAR (Adiciona o timestamp)
            videoData.dataAdicao = firebase.firestore.FieldValue.serverTimestamp();
            await videosCollection.add(videoData);
            message.textContent = `Vídeo "${titulo}" adicionado com sucesso!`;
        }

        message.style.color = 'green';
        setTimeout(() => {
            closeAndResetModal();
            listarVideosComFiltro(); // Recarrega a lista
        }, 1000);
    } catch (e) {
        console.error("Erro ao salvar documento: ", e);
        message.textContent = `Erro ao salvar: ${e.message}`;
        message.style.color = 'red';
    }
});


// =================================================================
// 3. LISTAGEM E FILTROS (Lógica AND)
// =================================================================

async function listarVideosComFiltro() {
    // Colspan ajustado para 3 colunas (Título, Descrição, Ações)
    videoList.innerHTML = '<tr><td colspan="3">Carregando vídeos...</td></tr>';
    allAvailableTags.clear();

    let query = videosCollection.orderBy('dataAdicao', 'desc');

    try {
        // Passo 1: Busca ampla OR no Firestore
        if (activeTags.length === 1) {
            query = videosCollection.where('tags', 'array-contains', activeTags[0]).orderBy('dataAdicao', 'desc');
        } else if (activeTags.length > 1) {
            // array-contains-any busca qualquer vídeo que tenha PELO MENOS uma das tags
            query = videosCollection.where('tags', 'array-contains-any', activeTags).orderBy('dataAdicao', 'desc');
        }

        const snapshot = await query.get();
        let videosComDados = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            // Coleta todas as tags de todos os vídeos visíveis (para o seletor)
            if (Array.isArray(data.tags)) data.tags.forEach(tag => allAvailableTags.add(tag));
            
            videosComDados.push({ id: doc.id, data: data });
        });

        // Passo 2: FILTRAGEM AND (E) no lado do cliente
        let videosFiltrados = videosComDados;
        if (activeTags.length > 1) {
            videosFiltrados = videosComDados.filter(video => {
                // .every() garante que CADA tag ativa está no array de tags do vídeo
                return activeTags.every(tag => video.data.tags.includes(tag));
            });
        }
        
        // Passo 3: Renderização
        videoList.innerHTML = '';
        if (videosFiltrados.length === 0) {
            // Colspan ajustado para 3 colunas
            videoList.innerHTML = '<tr><td colspan="3">Nenhum vídeo encontrado.</td></tr>';
        } else {
            videosFiltrados.forEach(v => renderVideoItem(v.id, v.data));
        }

        updateTagSelector();
        renderActiveFilters(); // Garante que os chips são atualizados

    } catch (e) {
        console.error("Erro na listagem/busca: ", e);
        videoList.innerHTML = '<tr><td colspan="3" style="color:red;">Ocorreu um erro ao buscar os dados. Verifique o console.</td></tr>';
    }
}

// ---------------------------------------------
// Funções de Ação (Renderizar, Deletar)
// ---------------------------------------------

function renderVideoItem(id, data) {
    const tr = document.createElement('tr');
    tr.id = `video-${id}`;
    tr.innerHTML = `
        <td>${data.titulo}</td>
        <td>${data.descricao || '—'}</td>
        <td class="actions">
            <a href="${data.url}" target="_blank" class="play-btn">▶</a>
            <button class="edit-btn" data-id="${id}">✏️</button>
            <button class="delete-btn" data-id="${id}">🗑️</button>
        </td>
    `;

    tr.querySelector('.delete-btn').addEventListener('click', () => deletarVideo(id, data.titulo));
    tr.querySelector('.edit-btn').addEventListener('click', () => openModal(true, id, data));
    videoList.appendChild(tr);
}

async function deletarVideo(id, titulo) {
    if (confirm(`Apagar "${titulo}"?`)) {
        try {
            await videosCollection.doc(id).delete();
            // Remove o elemento da tela
            document.getElementById(`video-${id}`)?.remove(); 
            alert(`Vídeo "${titulo}" apagado com sucesso!`);
            listarVideosComFiltro(); // Recarrega para atualizar o dropdown de tags
        } catch(e) {
            console.error("Erro ao apagar:", e);
            alert("Erro ao apagar o vídeo.");
        }
    }
}


// ---------------------------------------------
// Lógica do Seletor de Tags (Dropdown e Chips)
// ---------------------------------------------

function updateTagSelector() {
    tagSelector.innerHTML = '<option value="">Selecione tags para filtrar...</option>';
    Array.from(allAvailableTags)
        .sort()
        .forEach(tag => {
            if (!activeTags.includes(tag)) {
                const option = document.createElement('option');
                option.value = tag;
                option.textContent = tag.toUpperCase();
                tagSelector.appendChild(option);
            }
        });
}

function renderActiveFilters() {
    activeFiltersContainer.innerHTML = '';
    activeTags.forEach(tag => {
        const chip = document.createElement('div');
        chip.className = 'tag-chip';
        chip.innerHTML = `
            ${tag.toUpperCase()} 
            <span class="tag-chip-close" data-tag="${tag}">&times;</span>
        `;
        activeFiltersContainer.appendChild(chip);

        chip.querySelector('.tag-chip-close').addEventListener('click', (e) => {
            removeTagFilter(e.target.dataset.tag);
        });
    });
}

function removeTagFilter(tag) {
    activeTags = activeTags.filter(t => t !== tag);
    listarVideosComFiltro(); // Refiltrar e atualizar UI
}

tagSelector.addEventListener('change', (e) => {
    const tag = e.target.value;
    if (tag && !activeTags.includes(tag)) {
        activeTags.push(tag);
        listarVideosComFiltro();
        e.target.value = ''; // Reseta o dropdown
    }
});


// ---------------------------------------------
// Lógica de Ordenação
// ---------------------------------------------
const headers = document.querySelectorAll('#videoTable th[data-column]');
let sortDirection = 1;

headers.forEach(header => {
    header.addEventListener('click', () => {
        const column = header.getAttribute('data-column');
        sortTableByColumn(column);
        sortDirection *= -1;
    });
});

function sortTableByColumn(column) {
    const rows = Array.from(videoList.querySelectorAll('tr'));
    rows.sort((a, b) => {
        const aText = a.querySelector(`td:nth-child(${getColumnIndex(column)})`)?.innerText.toLowerCase() || '';
        const bText = b.querySelector(`td:nth-child(${getColumnIndex(column)})`)?.innerText.toLowerCase() || '';
        return aText.localeCompare(bText) * sortDirection;
    });
    videoList.innerHTML = '';
    rows.forEach(row => videoList.appendChild(row));
}

function getColumnIndex(columnName) {
    // Array de colunas ATUALIZADO (Título=1, Descrição=2)
    const columns = ['titulo', 'descricao']; 
    return columns.indexOf(columnName) + 1;
}

// =================================================================
// 5. INICIALIZAÇÃO E DARK MODE
// =================================================================

// Lógica de Alternância do Filtro
toggleFilterButton.addEventListener('click', () => {
    const isVisible = filterContainer.style.display === 'block';
    if (isVisible) {
        filterContainer.style.display = 'none';
        toggleFilterButton.textContent = '🔍';
    } else {
        filterContainer.style.display = 'block';
        toggleFilterButton.textContent = '❌';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // 1. Carrega lista completa
    listarVideosComFiltro();
    
    // 2. Lógica Dark Mode (MANTIDA)
    const toggleDarkMode = document.getElementById('toggleDarkMode');
    const savedDarkMode = localStorage.getItem('darkMode') === 'true';

    if (savedDarkMode) {
        document.body.classList.add('dark-mode');
        toggleDarkMode.textContent = '☀️';
    } else {
        toggleDarkMode.textContent = '🌙';
    }

    toggleDarkMode.addEventListener('click', () => {
        const darkModeAtivo = document.body.classList.toggle('dark-mode');
        localStorage.setItem('darkMode', darkModeAtivo);

        toggleDarkMode.textContent = darkModeAtivo
            ? '☀️'
            : '🌙';
    });

    // 3. Lógica de Deep Link (AGORA DENTRO DO DOMContentLoaded no script.js)
    const params = new URLSearchParams(window.location.search);
    const sharedLink = params.get('link');
    
    if (sharedLink) {
        const modal = document.getElementById('videoModal');
        const urlInput = document.getElementById('url');
        
        if (modal && urlInput) {
            modal.style.display = 'block';
            urlInput.value = decodeURIComponent(sharedLink);
        } else {
            console.error("ERRO: Elemento do modal ou do URL não encontrado. O Deep Link falhou.");
        }
    }
});