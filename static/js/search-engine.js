/**
 * search-engine.js
 * Full search implementation using Pagefind SDK.
 * Handles: live preview dropdown + full results page
 */

(function () {
    'use strict';

    // ─── CONFIG ────────────────────────────────────────────────────────────────
    const CONFIG = {
        PREVIEW_RESULTS_LIMIT: 5,       // max results shown in dropdown
        DEBOUNCE_MS: 220,               // ms delay before firing preview search
        MIN_QUERY_LENGTH: 2,            // don't search for 1-char queries
        SEARCH_PAGE_URL: '/search/',    // the full results page URL
        PAGEFIND_PATH: '/pagefind/pagefind.js',
    };

    // ─── STATE ──────────────────────────────────────────────────────────────────
    let pagefindInstance = null;
    let pagefindLoading = false;
    let debounceTimer = null;
    let activeDropdownIndex = -1;

    // ─── PAGEFIND LOADER ────────────────────────────────────────────────────────
    async function loadPagefind() {
        if (pagefindInstance) return pagefindInstance;
        if (pagefindLoading) {
            // Wait for the existing load to finish
            await new Promise(resolve => {
                const interval = setInterval(() => {
                    if (pagefindInstance) { clearInterval(interval); resolve(); }
                }, 50);
            });
            return pagefindInstance;
        }

        pagefindLoading = true;
        try {
            pagefindInstance = await import(CONFIG.PAGEFIND_PATH);
            await pagefindInstance.options({ ranking: { pageRank: 0.5 } });
        } catch (err) {
            console.warn('[Search] Pagefind failed to load:', err);
            pagefindInstance = null;
        }
        pagefindLoading = false;
        return pagefindInstance;
    }

    // ─── UTILITY: DEBOUNCE ──────────────────────────────────────────────────────
    function debounce(fn, ms) {
        return function (...args) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    // ─── UTILITY: GET URL QUERY PARAM ───────────────────────────────────────────
    function getQueryParam(param) {
        const params = new URLSearchParams(window.location.search);
        return params.get(param) || '';
    }

    // ─── UTILITY: HIGHLIGHT QUERY IN TEXT ───────────────────────────────────────
    function highlightQuery(text, query) {
        if (!query || !text) return text || '';
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }

    // ─── UTILITY: REDIRECT TO SEARCH PAGE ───────────────────────────────────────
    function redirectToSearchPage(query) {
        if (!query.trim()) return;
        const url = `${CONFIG.SEARCH_PAGE_URL}?q=${encodeURIComponent(query.trim())}`;
        window.location.href = url;
    }

    // ════════════════════════════════════════════════════════════════════════════
    // SECTION A: GLOBAL SEARCH BAR (header) — LIVE PREVIEW DROPDOWN
    // ════════════════════════════════════════════════════════════════════════════

    function initGlobalSearchBar() {
        const input = document.getElementById('global-search-input');
        if (!input) return;

        const dropdown = document.getElementById('search-preview-dropdown');
        const list = document.getElementById('search-preview-list');
        const footer = document.getElementById('search-preview-footer');
        const moreText = document.getElementById('search-preview-more');
        const wrapper = document.getElementById('global-search-wrapper');

        // Preload Pagefind when user focuses the input
        input.addEventListener('focus', () => loadPagefind());

        // ⌘K / Ctrl+K shortcut to focus search
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                input.focus();
                input.select();
            }
        });

        // Input handler with debounce
        input.addEventListener('input', debounce(async (e) => {
            const query = e.target.value.trim();

            if (query.length < CONFIG.MIN_QUERY_LENGTH) {
                closeDropdown(dropdown, list, footer, input);
                return;
            }

            const pf = await loadPagefind();
            if (!pf) return;

            try {
                const search = await pf.debouncedSearch(query);
                if (!search || !search.results) {
                    closeDropdown(dropdown, list, footer, input);
                    return;
                }

                const topResults = search.results.slice(0, CONFIG.PREVIEW_RESULTS_LIMIT);
                const totalCount = search.results.length;

                // Fetch data for each top result in parallel
                const dataPromises = topResults.map(r => r.data());
                const resultsData = await Promise.all(dataPromises);

                renderDropdown(resultsData, query, totalCount, list, footer, moreText, dropdown, input);
            } catch (err) {
                console.warn('[Search] Preview search error:', err);
            }
        }, CONFIG.DEBOUNCE_MS));

        // Keyboard navigation in dropdown
        input.addEventListener('keydown', (e) => {
            const items = list.querySelectorAll('.search-preview-item');

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeDropdownIndex = Math.min(activeDropdownIndex + 1, items.length - 1);
                updateActiveItem(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeDropdownIndex = Math.max(activeDropdownIndex - 1, -1);
                updateActiveItem(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (activeDropdownIndex >= 0 && items[activeDropdownIndex]) {
                    // Navigate to the highlighted result
                    const link = items[activeDropdownIndex].querySelector('a');
                    if (link) window.location.href = link.href;
                } else {
                    // No item selected — go to full search page
                    redirectToSearchPage(input.value);
                }
            } else if (e.key === 'Escape') {
                closeDropdown(dropdown, list, footer, input);
                input.blur();
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) {
                closeDropdown(dropdown, list, footer, input);
            }
        });
    }

    function renderDropdown(results, query, totalCount, list, footer, moreText, dropdown, input) {
        list.innerHTML = '';
        activeDropdownIndex = -1;

        if (results.length === 0) {
            list.innerHTML = `<li class="search-preview-no-results">No results for "<strong>${escapeHtml(query)}</strong>"</li>`;
            footer.style.display = 'none';
        } else {
            results.forEach((data, idx) => {
                const li = document.createElement('li');
                li.className = 'search-preview-item';
                li.setAttribute('role', 'option');
                li.setAttribute('data-index', idx);

                const title = data.meta?.title || 'Untitled';
                const excerpt = data.excerpt || '';

                li.innerHTML = `
          <a href="${data.url}" class="search-preview-link">
            <span class="search-preview-title">${highlightQuery(escapeHtml(title), query)}</span>
            <span class="search-preview-excerpt">${excerpt}</span>
          </a>
        `;

                list.appendChild(li);
            });

            // Footer: "showing 5 of 24 results"
            if (totalCount > CONFIG.PREVIEW_RESULTS_LIMIT) {
                moreText.textContent = `Showing 5 of ${totalCount} results`;
                footer.style.display = 'flex';
            } else {
                footer.style.display = 'none';
            }
        }

        dropdown.style.display = 'block';
        input.setAttribute('aria-expanded', 'true');
    }

    function closeDropdown(dropdown, list, footer, input) {
        dropdown.style.display = 'none';
        list.innerHTML = '';
        footer.style.display = 'none';
        activeDropdownIndex = -1;
        if (input) input.setAttribute('aria-expanded', 'false');
    }

    function updateActiveItem(items) {
        items.forEach((item, idx) => {
            if (idx === activeDropdownIndex) {
                item.classList.add('is-active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('is-active');
            }
        });
    }

    // ════════════════════════════════════════════════════════════════════════════
    // SECTION B: FULL SEARCH RESULTS PAGE (/search/?q=...)
    // ════════════════════════════════════════════════════════════════════════════

    function initSearchResultsPage() {
        const pageInput = document.getElementById('search-page-input');
        if (!pageInput) return;  // Not on search results page — exit

        const resultsContainer = document.getElementById('search-page-results');
        const emptyState = document.getElementById('search-page-empty');
        const emptyQuery = document.getElementById('search-empty-query');
        const loading = document.getElementById('search-page-loading');
        const countEl = document.getElementById('search-result-count');
        const searchBtn = document.getElementById('search-page-btn');

        // Read query from URL on page load
        const initialQuery = getQueryParam('q');
        if (initialQuery) {
            pageInput.value = initialQuery;
            runFullSearch(initialQuery, resultsContainer, emptyState, emptyQuery, loading, countEl);
        }

        // New search from results page input
        function handleSearch() {
            const query = pageInput.value.trim();
            if (!query) return;
            // Update URL without reload
            const newUrl = `${CONFIG.SEARCH_PAGE_URL}?q=${encodeURIComponent(query)}`;
            window.history.pushState({ query }, '', newUrl);
            runFullSearch(query, resultsContainer, emptyState, emptyQuery, loading, countEl);
        }

        pageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSearch();
        });

        if (searchBtn) {
            searchBtn.addEventListener('click', handleSearch);
        }

        // Handle browser back/forward
        window.addEventListener('popstate', (e) => {
            const q = getQueryParam('q');
            if (q) {
                pageInput.value = q;
                runFullSearch(q, resultsContainer, emptyState, emptyQuery, loading, countEl);
            }
        });
    }

    async function runFullSearch(query, resultsContainer, emptyState, emptyQuery, loading, countEl) {
        // Reset state
        resultsContainer.innerHTML = '';
        emptyState.style.display = 'none';
        loading.style.display = 'block';
        countEl.textContent = '';

        const pf = await loadPagefind();
        if (!pf) {
            loading.style.display = 'none';
            countEl.textContent = 'Search is unavailable. Please try again later.';
            return;
        }

        try {
            const search = await pf.search(query);
            loading.style.display = 'none';

            if (!search || search.results.length === 0) {
                emptyState.style.display = 'block';
                if (emptyQuery) emptyQuery.textContent = query;
                countEl.textContent = '0 results';
                return;
            }

            const total = search.results.length;
            countEl.textContent = `${total} result${total !== 1 ? 's' : ''} for "${query}"`;

            // Render results in batches for performance (5k+ pages = potentially many results)
            await renderResultsBatched(search.results, query, resultsContainer);

        } catch (err) {
            console.warn('[Search] Full search error:', err);
            loading.style.display = 'none';
            countEl.textContent = 'An error occurred. Please try again.';
        }
    }

    async function renderResultsBatched(results, query, container) {
        const BATCH_SIZE = 10;

        for (let i = 0; i < results.length; i += BATCH_SIZE) {
            const batch = results.slice(i, i + BATCH_SIZE);
            const dataPromises = batch.map(r => r.data());
            const batchData = await Promise.all(dataPromises);

            batchData.forEach(data => {
                const card = createResultCard(data, query);
                container.appendChild(card);
            });

            // Yield to browser between batches to avoid blocking UI
            if (i + BATCH_SIZE < results.length) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
    }

    function createResultCard(data, query) {
        const div = document.createElement('div');
        div.className = 'search-result-card';

        const title = data.meta?.title || 'Untitled Article';
        const excerpt = data.excerpt || '';
        const url = data.url || '#';

        // Build a clean URL display (strip domain)
        const displayUrl = url.replace(/^https?:\/\/[^\/]+/, '');

        div.innerHTML = `
      <a class="search-result-title" href="${url}">${escapeHtml(title)}</a>
      <div class="search-result-url">${escapeHtml(displayUrl)}</div>
      <div class="search-result-excerpt">${excerpt}</div>
    `;

        return div;
    }

    // ─── UTILITY: ESCAPE HTML ────────────────────────────────────────────────────
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // ─── INIT ────────────────────────────────────────────────────────────────────
    function init() {
        initGlobalSearchBar();
        initSearchResultsPage();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
