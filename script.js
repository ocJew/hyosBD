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

// =================================================================
// HABILITA A PERSISTÊNCIA OFFLINE (MELHORIA APP MOBILE)
// =================================================================
try {
    firebase.firestore().enablePersistence()
      .catch((err) => {
          if (err.code == 'failed-precondition') {
              console.warn("Firestore: Persistência já ativa em outra aba.");
          } else if (err.code == 'unimplemented') {
              console.warn("Firestore: Navegador não suporta persistência.");
          }
      });
} catch (e) {
    console.error("Erro ao habilitar persistência: ", e);
}
// =================================================================

const videosCollection = db.collection("videos");
const tagsGeraisCollection = db.collection("tagsGerais"); 


// Elementos
const videoModal = document.getElementById('videoModal');
const closeModalButton = document.getElementById('closeModal');
const openAddModalButton = document.getElementById('openAddModal');
const addButton = document.getElementById('addButton');
const message = document.getElementById('message');
const videoList = document.getElementById('videoList');
const activeFiltersContainer = document.getElementById('activeFilters');
const filterContainer = document.getElementById('filterContainer');
const toggleFilterButton = document.getElementById('toggleFilter');

// ATENÇÃO: 'tags' agora é o elemento Select2 (jQuery) (Seletor do MODAL)
const tagsSelect = $('#tags'); 

const availableTagsList = document.getElementById('availableTagsList');
const showAllButton = document.getElementById('showAllButton'); // NOVO ELEMENTO

let activeTags = []; // Tags atualmente sendo usadas para filtrar (Chips)
let masterTagList = []; // Lista MESTRA de todas as tags, vinda do 'tagsGeraisCollection'


// =================================================================
// 2. FUNÇÕES DO MODAL (ADICIONAR/EDITAR)
// =================================================================

// ... (Todas as funções do Modal (openModal, closeAndResetModal, saveNewTags, e o listener 'addButton') 
// permanecem EXATAMENTE IGUAIS. Não há necessidade de alterá-las.) ...

function openModal(isEdit = false, docId = null, data = {}) {
    document.getElementById('url').value = data.url || '';
    document.getElementById('titulo').value = data.titulo || '';
    document.getElementById('descricao').value = data.descricao || '';
    message.textContent = '';
    const tagsParaSelect2 = Array.isArray(data.tags) ? data.tags.map(t => t.toLowerCase()) : [];
    if(tagsSelect.data('select2')) {
        tagsSelect.val(tagsParaSelect2).trigger('change'); 
    } else {
        initializeSelect2();
        tagsSelect.val(tagsParaSelect2).trigger('change');
    }
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
    document.getElementById('url').value = '';
    document.getElementById('titulo').value = '';
    document.getElementById('descricao').value = '';
    tagsSelect.val(null).trigger('change');
    message.textContent = '';
    delete addButton.dataset.editId;
}

openAddModalButton.addEventListener('click', () => openModal(false));
closeModalButton.addEventListener('click', closeAndResetModal);
window.addEventListener('click', (event) => {
    if (event.target === videoModal && !$(event.target).closest('.select2-container').length) {
        closeAndResetModal();
    }
});

async function saveNewTags(tagsArray) {
    const promises = tagsArray.map(async tagText => {
        const trimmedTagText = tagText.trim(); 
        if(trimmedTagText.length === 0) return;
        const tagId = trimmedTagText.toLowerCase();
        const tagRef = tagsGeraisCollection.doc(tagId);
        const doc = await tagRef.get();
        if (!doc.exists) {
            const capitalizedName = trimmedTagText.charAt(0).toUpperCase() + trimmedTagText.slice(1);
            await tagRef.set({ nome: capitalizedName, dataCriacao: firebase.firestore.FieldValue.serverTimestamp() });
        }
    });
    await Promise.all(promises);
}

addButton.addEventListener('click', async () => {
    const docId = addButton.dataset.editId;
    const url = document.getElementById('url').value;
    const titulo = document.getElementById('titulo').value;
    const descricao = document.getElementById('descricao').value;
    const tagsArray = tagsSelect.select2('data')
        .map(item => item.text.trim())
        .filter(tag => tag.length > 0);
    
    if (!url || !titulo || tagsArray.length === 0) {
        message.textContent = 'Erro: URL, Título e Tags são obrigatórios!';
        message.style.color = 'red';
        return;
    }
    await saveNewTags(tagsArray);
    const tagsArrayLowerCase = tagsArray.map(t => t.toLowerCase());
    const videoData = { url, titulo, descricao, tags: tagsArrayLowerCase };

    try {
        if (docId) {
            await videosCollection.doc(docId).update(videoData);
            message.textContent = `Vídeo "${titulo}" editado com sucesso!`;
        } else {
            videoData.dataAdicao = firebase.firestore.FieldValue.serverTimestamp();
            await videosCollection.add(videoData);
            message.textContent = `Vídeo "${titulo}" adicionado com sucesso!`;
        }
        message.style.color = 'green';
        setTimeout(async () => {
            closeAndResetModal();
            masterTagList = await loadPredefinedTags();
            initializeSelect2(); 
            listarVideosComFiltro(); 
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

// NOVA FUNÇÃO: Lista TODOS os vídeos, ignorando filtros
async function listarTodosVideos() {
    videoList.innerHTML = '<p>Carregando todos os vídeos...</p>';
    
    // Limpa quaisquer filtros ativos
    activeTags = [];
    renderActiveFilters();
    renderAvailableTags();
    
    // Rola para o topo
    window.scrollTo({ top: 0, behavior: 'smooth' });

    let query = videosCollection.orderBy('dataAdicao', 'desc');

    try {
        let snapshot;
        try {
            snapshot = await query.get({ source: 'cache' });
            if (snapshot.empty) {
                snapshot = await query.get({ source: 'server' });
            }
        } catch(e) {
            snapshot = await query.get({ source: 'server' });
        }
        
        videoList.innerHTML = '';
        if (snapshot.empty) {
            videoList.innerHTML = '<p>Nenhum vídeo encontrado no catálogo.</p>';
        } else {
            snapshot.forEach(doc => {
                renderVideoItem(doc.id, doc.data());
            });
        }
    } catch (e) {
        console.error("Erro ao listar todos os vídeos: ", e);
        videoList.innerHTML = '<p style="color:red;">Ocorreu um erro ao buscar os dados.</p>';
    }
}


// ATUALIZADA: Lista vídeos FILTRADOS
async function listarVideosComFiltro() {

    // Cláusula de Guarda: Se nenhum filtro estiver ativo, não faz a consulta.
    if (activeTags.length === 0) {
        videoList.innerHTML = '<p style="font-size: 1.1em; color: #888; text-align: center; margin-top: 50px;">Selecione uma tag acima para começar.</p>';
        
        // Atualiza a UI de filtros (para mostrar todas as tags como disponíveis)
        renderActiveFilters();
        renderAvailableTags();
        return; // Para a execução da função aqui
    }

    videoList.innerHTML = '<p>Carregando vídeos...</p>';

    let query; // A query não é mais definida por padrão

    try {
        // Passo 1: Definir a query base (agora só roda se activeTags.length > 0)
        if (activeTags.length === 1) {
            query = videosCollection.where('tags', 'array-contains', activeTags[0]).orderBy('dataAdicao', 'desc');
        } else { // activeTags.length > 1
            query = videosCollection.where('tags', 'array-contains-any', activeTags).orderBy('dataAdicao', 'desc');
        }

        let snapshot;
        try {
            snapshot = await query.get({ source: 'cache' });
            if (snapshot.empty) {
                snapshot = await query.get({ source: 'server' });
            }
        } catch(e) {
            snapshot = await query.get({ source: 'server' });
        }
        
        let videosComDados = [];
        snapshot.forEach(doc => {
            videosComDados.push({ id: doc.id, data: doc.data() });
        });

        // Passo 2: FILTRAGEM AND (E) no lado do cliente
        let videosFiltrados = videosComDados;
        if (activeTags.length > 1) {
            videosFiltrados = videosComDados.filter(video => {
                return activeTags.every(tag => video.data.tags.includes(tag));
            });
        }
        
        // Passo 3: Renderização dos Vídeos
        videoList.innerHTML = '';
        if (videosFiltrados.length === 0) {
            videoList.innerHTML = '<p>Nenhum vídeo encontrado para esta combinação de filtros.</p>';
        } else {
            videosFiltrados.forEach(v => renderVideoItem(v.id, v.data));
        }

        // Passo 4: Renderização da UI de Filtro
        renderActiveFilters(); // Renderiza os chips de filtros ativos
        renderAvailableTags(); // Renderiza os chips de tags disponíveis

    } catch (e) {
        console.error("Erro na listagem/busca: ", e);
        if(e.code === 'offline' || e.message.includes('offline')) {
             videoList.innerHTML = '<p>Você está offline. Mostrando dados salvos...</p>';
        } else {
             videoList.innerHTML = '<p style="color:red;">Ocorreu um erro ao buscar os dados. Verifique o console.</p>';
        }
    }
}


// ---------------------------------------------
// Funções de Ação (Renderizar, Deletar)
// ---------------------------------------------

function renderVideoItem(id, data) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.id = `video-${id}`;

    const tagsHtml = data.tags.map(tagId => {
        const tagObj = masterTagList.find(t => t.id === tagId);
        const tagName = tagObj ? tagObj.text : tagId; 
        
        return `<span class="card-tag clickable-tag" data-tag-id="${tagId}">${tagName}</span>`;
    }).join('');

    card.innerHTML = `
        <div class="card-content">
            <h3 class="card-title">${data.titulo}</h3>
            <p class="card-description">${data.descricao || 'Nenhuma descrição fornecida.'}</p>
            <div class="card-tags-container">
                ${tagsHtml}
            </div>
        </div>
        <div class="card-actions">
            <a href="${data.url}" target="_blank" class="action-btn play-btn" title="Assistir">▶️</a>
            <button class="action-btn edit-btn" data-id="${id}" title="Editar">✏️</button>
            <button class="action-btn delete-btn" data-id="${id}" title="Deletar">🗑️</button>
        </div>
    `;

    card.querySelector('.delete-btn').addEventListener('click', () => deletarVideo(id, data.titulo));
    card.querySelector('.edit-btn').addEventListener('click', () => openModal(true, id, data));
    
    // Adiciona listeners de clique para as tags do card
    card.querySelectorAll('.clickable-tag').forEach(tagSpan => {
        tagSpan.addEventListener('click', (e) => {
            const tagId = e.target.dataset.tagId;
            addTagFilter(tagId); // Reutiliza a função de filtro existente
        });
    });

    videoList.appendChild(card);
}

async function deletarVideo(id, titulo) {
    if (confirm(`Apagar "${titulo}"?`)) {
        try {
            await videosCollection.doc(id).delete();
            document.getElementById(`video-${id}`)?.remove();
            alert(`Vídeo "${titulo}" apagado com sucesso!`);
            listarVideosComFiltro(); // Relista (pode mostrar a msg "Selecione..." se for o último)
        } catch(e) {
            console.error("Erro ao apagar:", e);
            alert("Erro ao apagar o vídeo.");
        }
    }
}

// ---------------------------------------------
// Lógica do Seletor de Tags (Dropdown e Chips)
// ---------------------------------------------

function renderActiveFilters() {
    activeFiltersContainer.innerHTML = '';
    if(activeTags.length === 0) {
        activeFiltersContainer.innerHTML = '<p style="font-size: 0.9em; color: #888;">Nenhum filtro ativo.</p>';
    }
    
    activeTags.forEach(tagId => {
        const chip = document.createElement('div');
        chip.className = 'tag-chip';
        const tagText = masterTagList.find(t => t.id === tagId)?.text || tagId.toUpperCase();
        
        chip.innerHTML = `
            ${tagText}
            <span class="tag-chip-close" data-tag="${tagId}">&times;</span>
        `;
        activeFiltersContainer.appendChild(chip);

        chip.querySelector('.tag-chip-close').addEventListener('click', (e) => {
            removeTagFilter(e.target.dataset.tag);
        });
    });
}

function renderAvailableTags() {
    availableTagsList.innerHTML = '';
    
    masterTagList
        .sort((a, b) => a.text.localeCompare(b.text))
        .forEach(tag => {
            if (!activeTags.includes(tag.id)) {
                const chip = document.createElement('div');
                chip.className = 'available-tag-chip';
                chip.innerHTML = `
                    <span class="tag-text" data-tag-id="${tag.id}">${tag.text}</span>
                    <span class="delete-tag-btn" data-tag-id="${tag.id}" data-tag-name="${tag.text}" title="Apagar Tag">&times;</span>
                `;
                chip.querySelector('.tag-text').addEventListener('click', (e) => {
                    addTagFilter(e.target.dataset.tagId);
                });
                chip.querySelector('.delete-tag-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteTag(e.target.dataset.tagId, e.target.dataset.tagName);
                });
                availableTagsList.appendChild(chip);
            }
        });
    
    if(availableTagsList.innerHTML === '') {
        availableTagsList.innerHTML = '<p style="font-size: 0.9em; color: #888;">Todas as tags estão ativas.</p>';
    }
}


function addTagFilter(tagId) {
    if (tagId && !activeTags.includes(tagId)) {
        activeTags.push(tagId);
        listarVideosComFiltro(); // Re-renderiza tudo

        // Garante que o painel de filtro esteja visível
        if (filterContainer.style.display !== 'block') {
            filterContainer.style.display = 'block';
            toggleFilterButton.textContent = '❌';
        }
        
        // Rola a página para o topo para ver o filtro
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function removeTagFilter(tagId) {
    activeTags = activeTags.filter(t => t !== tagId);
    listarVideosComFiltro(); // Re-renderiza tudo (e vai mostrar msg inicial se activeTags == 0)
}


// =================================================================
// 4. INICIALIZAÇÃO E LÓGICA DO SELECT2 (DO MODAL)
// =================================================================

async function loadPredefinedTags() {
    try {
        let snapshot = await tagsGeraisCollection.get({ source: 'cache' });
        if (snapshot.empty) {
            snapshot = await tagsGeraisCollection.get({ source: 'server' });
        }
        
        const tags = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.nome) { 
                tags.push({ id: data.nome.toLowerCase(), text: data.nome }); 
            }
        });
        return tags;
    } catch(e) {
        console.error("Erro ao carregar tags gerais:", e);
        return [];
    }
}

function initializeSelect2() {
    if (tagsSelect.data('select2')) {
        tagsSelect.select2('destroy');
    }
    tagsSelect.select2({
        data: masterTagList, 
        placeholder: "Selecione ou digite tags (pesquisável)",
        tags: true, 
        tokenSeparators: [','] 
    });
}


// Lógica de Alternância do Filtro (Botão 🔍)
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


// =================================================================
// 5. FUNÇÕES DE GERENCIAMENTO DE TAGS (APAGAR)
// =================================================================

async function deleteTag(tagId, tagName) {
    if (!confirm(`TEM CERTEZA?\n\nVocê está prestes a apagar a tag "${tagName}" (${tagId}) PERMANENTEMENTE.\n\nIsso irá remover a tag de TODOS os vídeos que a utilizam. Esta ação não pode ser desfeita.`)) {
        return;
    }
    console.log(`Iniciando exclusão da tag: ${tagId}`);
    try {
        const videosQuery = videosCollection.where('tags', 'array-contains', tagId);
        const snapshot = await videosQuery.get();
        const batch = db.batch();
        snapshot.forEach(doc => {
            const videoRef = videosCollection.doc(doc.id);
            batch.update(videoRef, {
                tags: firebase.firestore.FieldValue.arrayRemove(tagId)
            });
        });
        const tagRef = tagsGeraisCollection.doc(tagId);
        batch.delete(tagRef);
        await batch.commit();
        alert(`Tag "${tagName}" apagada com sucesso de ${snapshot.size} vídeos e do catálogo.`);
        masterTagList = await loadPredefinedTags();
        initializeSelect2();
        listarVideosComFiltro(); // Re-renderiza UI (vai mostrar msg inicial se filtros estiverem vazios)
    } catch (e) {
        console.error("Erro ao apagar a tag:", e);
        alert(`Ocorreu um erro ao apagar a tag: ${e.message}`);
    }
}


// =================================================================
// 6. INICIALIZAÇÃO DA PÁGINA
// =================================================================

document.addEventListener('DOMContentLoaded', async () => {
    
    // 1. CARREGA A LISTA MESTRA DE TAGS PRIMEIRO
    masterTagList = await loadPredefinedTags();

    // 2. Carrega e inicializa o Select2 (do modal)
    initializeSelect2();
    
    // 3. Renderiza filtros e mensagem inicial (SEM carregar vídeos)
    renderActiveFilters();
    renderAvailableTags();
    videoList.innerHTML = '<p style="font-size: 1.1em; color: #888; text-align: center; margin-top: 50px;">Selecione uma tag acima para começar.</p>';

    // 4. Lógica Dark Mode (MANTIDA)
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
        toggleDarkMode.textContent = darkModeAtivo ? '☀️' : '🌙';
    });

    // 5. NOVO: Listener para o botão "Mostrar Todos"
    showAllButton.addEventListener('click', listarTodosVideos);

    // 6. Lógica de Deep Link (MANTIDA)
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