/**
 * HYOS Video Catalog - Core Script
 * Modularized for better maintainability and performance.
 */

// =================================================================
// 1. CONFIGURATION & INITIALIZATION
// =================================================================

const firebaseConfig = {
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

// Enable offline persistence
db.enablePersistence().catch((err) => {
    if (err.code === 'failed-precondition') console.warn("Firestore: Multiple tabs open, persistence disabled.");
    else if (err.code === 'unimplemented') console.warn("Firestore: Browser doesn't support persistence.");
});

const COLLECTIONS = {
    VIDEOS: db.collection("videos"),
    TAGS: db.collection("tagsGerais")
};

// =================================================================
// 2. STATE MANAGEMENT
// =================================================================

let state = {
    activeTags: [],
    masterTagList: [],
    searchQuery: '',
    isDarkMode: localStorage.getItem('darkMode') === 'true',
    isFilterVisible: false
};

// =================================================================
// 3. UI HELPERS & COMPONENTS
// =================================================================

/**
 * Shows a professional toast notification
 * @param {string} msg - The message to show
 * @param {'success' | 'error' | 'info'} type - Toast type
 */
function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: 'check-circle',
        error: 'alert-circle',
        info: 'info'
    };

    toast.innerHTML = `
        <i data-lucide="${icons[type]}" class="toast-icon"></i>
        <span>${msg}</span>
    `;

    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

/**
 * Toggles loading skeletons in the video grid
 * @param {boolean} show - Whether to show skeletons
 */
function toggleLoadingSkeletons(show) {
    const videoList = document.getElementById('videoList');
    if (!show) {
        // Only clear if we have actual content coming, otherwise it might flicker
        return;
    }

    videoList.innerHTML = '';
    for (let i = 0; i < 6; i++) {
        videoList.innerHTML += `
            <div class="skeleton-card">
                <div class="skeleton-title skeleton"></div>
                <div class="skeleton-description skeleton"></div>
                <div class="skeleton-tags skeleton"></div>
                <div class="skeleton-actions skeleton"></div>
            </div>
        `;
    }
}

function updateDarkModeUI() {
    const btn = document.getElementById('toggleDarkMode');
    if (state.isDarkMode) {
        document.body.classList.add('dark-mode');
        btn.innerHTML = '<i data-lucide="sun"></i>';
    } else {
        document.body.classList.remove('dark-mode');
        btn.innerHTML = '<i data-lucide="moon"></i>';
    }
    lucide.createIcons();
}

// =================================================================
// 4. FIREBASE OPERATIONS
// =================================================================

async function fetchMasterTags() {
    try {
        const snapshot = await COLLECTIONS.TAGS.get();
        state.masterTagList = snapshot.docs.map(doc => ({
            id: doc.id,
            text: doc.data().nome
        }));
    } catch (e) {
        console.error("Error loading tags:", e);
        showToast("Erro ao carregar tags.", "error");
    }
}

async function fetchVideos() {
    toggleLoadingSkeletons(true);

    let query = COLLECTIONS.VIDEOS.orderBy('dataAdicao', 'desc');

    // Remote filtering optimization: if only 1 tag, let Firestore do it
    if (state.activeTags.length === 1) {
        query = query.where('tags', 'array-contains', state.activeTags[0]);
    } else if (state.activeTags.length > 1) {
        // Note: For multiple tags (AND logic), we fetch and filter locally to avoid complex indexes
        query = query.where('tags', 'array-contains-any', state.activeTags);
    }

    try {
        const snapshot = await query.get();
        let videos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Client-side filtering for search and multiple tags (AND)
        videos = videos.filter(v => {
            const matchesSearch = state.searchQuery === '' ||
                v.titulo.toLowerCase().includes(state.searchQuery) ||
                (v.descricao && v.descricao.toLowerCase().includes(state.searchQuery));

            const matchesAllTags = state.activeTags.every(tag => v.tags.includes(tag));

            return matchesSearch && matchesAllTags;
        });

        renderVideoGrid(videos);
    } catch (e) {
        console.error("Error fetching videos:", e);
        showToast("Erro ao carregar vídeos.", "error");
    }
}

async function saveVideo(videoData, editId = null) {
    try {
        // Save new tags to master list first
        const newTags = videoData.tags.map(async tagText => {
            const tagId = tagText.toLowerCase().trim();
            const tagRef = COLLECTIONS.TAGS.doc(tagId);
            const doc = await tagRef.get();
            if (!doc.exists) {
                const capitalized = tagText.charAt(0).toUpperCase() + tagText.slice(1);
                await tagRef.set({ nome: capitalized, dataCriacao: firebase.firestore.FieldValue.serverTimestamp() });
            }
        });
        await Promise.all(newTags);

        const data = {
            ...videoData,
            tags: videoData.tags.map(t => t.toLowerCase().trim())
        };

        if (editId) {
            await COLLECTIONS.VIDEOS.doc(editId).update(data);
            showToast("Vídeo atualizado com sucesso!", "success");
        } else {
            data.dataAdicao = firebase.firestore.FieldValue.serverTimestamp();
            await COLLECTIONS.VIDEOS.add(data);
            showToast("Vídeo adicionado com sucesso!", "success");
        }

        await fetchMasterTags();
        initializeSelect2();
        fetchVideos();
        closeAndResetModal();
    } catch (e) {
        console.error("Save error:", e);
        showToast("Erro ao salvar vídeo.", "error");
    }
}

async function deleteVideo(id, title) {
    if (!confirm(`Deseja realmente excluir "${title}"?`)) return;

    try {
        await COLLECTIONS.VIDEOS.doc(id).delete();
        showToast("Vídeo excluído.", "success");
        fetchVideos();
    } catch (e) {
        showToast("Erro ao excluir vídeo.", "error");
    }
}

// =================================================================
// 5. RENDERING FUNCTIONS
// =================================================================

function renderVideoGrid(videos) {
    const container = document.getElementById('videoList');
    container.innerHTML = '';

    if (videos.length === 0) {
        container.innerHTML = '<p class="info-msg">Nenhum vídeo encontrado.</p>';
        return;
    }

    videos.forEach(v => {
        const card = document.createElement('div');
        card.className = 'video-card';

        const tagsHtml = v.tags.map(tagId => {
            const tag = state.masterTagList.find(t => t.id === tagId);
            return `<span class="card-tag clickable-tag" data-tag-id="${tagId}">${tag ? tag.text : tagId}</span>`;
        }).join('');

        card.innerHTML = `
            <div class="card-content">
                <h3 class="card-title">${v.titulo}</h3>
                <p class="card-description">${v.descricao || 'Sem descrição.'}</p>
                <div class="card-tags-container">${tagsHtml}</div>
            </div>
            <div class="card-actions">
                <a href="${v.url}" target="_blank" class="action-btn play-btn" title="Assistir"><i data-lucide="play"></i> Assistir</a>
                <button class="action-btn edit-btn" data-id="${v.id}" title="Editar"><i data-lucide="edit-3"></i></button>
                <button class="action-btn delete-btn" data-id="${v.id}" title="Excluir"><i data-lucide="trash-2"></i></button>
                <button class="action-btn share-btn" data-url="${v.url}" title="Compartilhar Link Local"><i data-lucide="share-2"></i></button>
            </div>
        `;

        // Event Listeners
        card.querySelector('.edit-btn').onclick = () => openModal(true, v.id, v);
        card.querySelector('.delete-btn').onclick = () => deleteVideo(v.id, v.titulo);
        card.querySelector('.share-btn').onclick = () => {
            const shareUrl = `${window.location.origin}${window.location.pathname}?link=${encodeURIComponent(v.url)}`;
            navigator.clipboard.writeText(shareUrl);
            showToast("Link de compartilhamento copiado!", "success");
        };
        card.querySelectorAll('.clickable-tag').forEach(tag => {
            tag.onclick = (e) => addTagFilter(e.target.dataset.tagId);
        });

        container.appendChild(card);
    });

    lucide.createIcons();
    renderFiltersUI();
}

function renderFiltersUI() {
    const activeCont = document.getElementById('activeFilters');
    const availCont = document.getElementById('availableTagsList');

    // Active Filters
    activeCont.innerHTML = state.activeTags.length ? '' : '<p class="muted-text">Sem filtros ativos.</p>';
    state.activeTags.forEach(tagId => {
        const tag = state.masterTagList.find(t => t.id === tagId);
        const chip = document.createElement('div');
        chip.className = 'tag-chip';
        chip.innerHTML = `${tag ? tag.text : tagId} <span class="tag-chip-close" data-tag="${tagId}">&times;</span>`;
        chip.querySelector('.tag-chip-close').onclick = () => removeTagFilter(tagId);
        activeCont.appendChild(chip);
    });

    // Available Tags
    availCont.innerHTML = '';
    state.masterTagList
        .filter(t => !state.activeTags.includes(t.id))
        .sort((a, b) => a.text.localeCompare(b.text))
        .forEach(tag => {
            const chip = document.createElement('div');
            chip.className = 'available-tag-chip';
            chip.innerHTML = `
                <span class="tag-text">${tag.text}</span>
                <span class="delete-tag-btn" title="Apagar Tag">&times;</span>
            `;
            chip.querySelector('.tag-text').onclick = () => addTagFilter(tag.id);
            chip.querySelector('.delete-tag-btn').onclick = (e) => {
                e.stopPropagation();
                deleteTagMaster(tag.id, tag.text);
            };
            availCont.appendChild(chip);
        });
}

// =================================================================
// 6. MODAL & FORM LOGIC
// =================================================================

function openModal(isEdit = false, id = null, data = {}) {
    const modal = document.getElementById('videoModal');
    const titleEle = document.getElementById('modalTitle');
    const saveBtn = document.getElementById('addButton');

    document.getElementById('url').value = data.url || '';
    document.getElementById('titulo').value = data.titulo || '';
    document.getElementById('descricao').value = data.descricao || '';

    const tags = data.tags || [];
    $('#tags').val(tags).trigger('change');

    if (isEdit) {
        titleEle.textContent = `Editar: ${data.titulo}`;
        saveBtn.textContent = 'Salvar Alterações';
        saveBtn.dataset.editId = id;
    } else {
        titleEle.textContent = 'Adicionar Vídeo';
        saveBtn.textContent = 'Adicionar ao Catálogo';
        delete saveBtn.dataset.editId;
    }

    modal.style.display = 'flex';
}

function closeAndResetModal() {
    document.getElementById('videoModal').style.display = 'none';
    document.querySelectorAll('#videoModal input, #videoModal textarea').forEach(i => i.value = '');
    $('#tags').val(null).trigger('change');
}

function initializeSelect2() {
    $('#tags').select2({
        data: state.masterTagList,
        placeholder: "Selecione ou digite tags...",
        tags: true,
        tokenSeparators: [',']
    });
}

// =================================================================
// 7. EVENT HANDLERS & INITIALIZATION
// =================================================================

function addTagFilter(id) {
    if (!state.activeTags.includes(id)) {
        state.activeTags.push(id);
        fetchVideos();
    }
}

function removeTagFilter(id) {
    state.activeTags = state.activeTags.filter(t => t !== id);
    fetchVideos();
}

async function deleteTagMaster(id, name) {
    if (!confirm(`Apagar tag "${name}" de TUDO?`)) return;

    try {
        const batch = db.batch();
        const videosWithTag = await COLLECTIONS.VIDEOS.where('tags', 'array-contains', id).get();
        videosWithTag.forEach(doc => {
            batch.update(COLLECTIONS.VIDEOS.doc(doc.id), {
                tags: firebase.firestore.FieldValue.arrayRemove(id)
            });
        });
        batch.delete(COLLECTIONS.TAGS.doc(id));
        await batch.commit();

        showToast(`Tag "${name}" removida.`, "success");
        await fetchMasterTags();
        initializeSelect2();
        fetchVideos();
    } catch (e) {
        showToast("Erro ao apagar tag.", "error");
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initial UI Setup
    updateDarkModeUI();

    // 2. Load Data
    await fetchMasterTags();
    initializeSelect2();
    fetchVideos();

    // 3. Global Event Bindings
    document.getElementById('toggleDarkMode').onclick = () => {
        state.isDarkMode = !state.isDarkMode;
        localStorage.setItem('darkMode', state.isDarkMode);
        updateDarkModeUI();
    };

    document.getElementById('toggleFilter').onclick = () => {
        const cont = document.getElementById('filterContainer');
        state.isFilterVisible = !state.isFilterVisible;
        cont.style.display = state.isFilterVisible ? 'block' : 'none';
        document.getElementById('toggleFilter').innerHTML = state.isFilterVisible ? '<i data-lucide="x"></i>' : '<i data-lucide="filter"></i>';
        lucide.createIcons();
    };

    document.getElementById('openAddModal').onclick = () => openModal();
    document.getElementById('closeModal').onclick = closeAndResetModal;

    document.getElementById('addButton').onclick = async () => {
        const url = document.getElementById('url').value;
        const titulo = document.getElementById('titulo').value;
        const descricao = document.getElementById('descricao').value;
        const tags = $('#tags').select2('data').map(t => t.text.trim());
        const editId = document.getElementById('addButton').dataset.editId;

        if (!url || !titulo || tags.length === 0) {
            showToast("Preencha todos os campos obrigatórios!", "error");
            return;
        }

        await saveVideo({ url, titulo, descricao, tags }, editId);
    };

    // Real-time Search with Debounce
    let searchTimeout;
    document.getElementById('searchInput').oninput = (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            state.searchQuery = e.target.value.toLowerCase().trim();
            fetchVideos();
        }, 300);
    };

    document.getElementById('showAllButton').onclick = () => {
        state.activeTags = [];
        state.searchQuery = '';
        document.getElementById('searchInput').value = '';
        fetchVideos();
    };

    // Deep linking support
    const params = new URLSearchParams(window.location.search);
    const sharedLink = params.get('link');
    if (sharedLink) openModal(false, null, { url: decodeURIComponent(sharedLink) });
});

window.onclick = (e) => {
    if (e.target === document.getElementById('videoModal')) closeAndResetModal();
};