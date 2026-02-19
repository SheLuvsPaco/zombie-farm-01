/**
 * Tech Search Page Functionality - Powered by Pagefind
 * Handles search results display, filtering, sorting, and pagination
 */

(function () {
    'use strict';

    // State
    let pagefind = null;
    let filteredResults = [];
    let currentPage = 1;
    let currentQuery = '';
    let selectedCategories = ['Comparisons', 'Integrations', 'Troubleshooting', 'Guides'];
    let selectedTag = null;
    let currentSort = 'relevance';
    const resultsPerPage = 12;

    // DOM Elements
    const searchInput = document.getElementById('pageSearchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    const resultsContainer = document.getElementById('searchResultsContainer');
    const resultsTitle = document.getElementById('resultsTitle');
    const categoryFilters = document.getElementById('categoryFilters');
    const popularTags = document.getElementById('popularTags');
    const sortSelect = document.getElementById('sortSelect');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');
    const searchPagination = document.getElementById('searchPagination');

    /**
     * Initialize search page
     */
    async function init() {
        showLoading();

        try {
            // Dynamically import pagefind
            const baseUrl = document.querySelector('base')?.href || '/';
            pagefind = await import(baseUrl + "pagefind/pagefind.js");
            await pagefind.init();

            // Get query from URL
            const urlParams = new URLSearchParams(window.location.search);
            currentQuery = urlParams.get('q') || '';

            if (currentQuery) {
                searchInput.value = currentQuery;
                clearBtn.style.display = 'flex';
            }

            // Populate filters using Pagefind metadata
            await populateFilters();

            // Perform initial search
            performSearch();

            // Setup event listeners
            setupEventListeners();

        } catch (error) {
            console.error('Search page initialization error:', error);
            showError('Failed to load search index. Please ensure Pagefind has been run on the built site.');
        }
    }

    /**
     * Populate filters directly from pagefind filters API
     */
    async function populateFilters() {
        try {
            const filters = await pagefind.filters();

            // Populate Categories
            const categoryCounts = filters.categories || {};
            const checkboxes = categoryFilters.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                const countSpan = checkbox.parentElement.querySelector('.count');
                if (countSpan && categoryCounts[checkbox.value]) {
                    countSpan.textContent = categoryCounts[checkbox.value];
                } else if (countSpan) {
                    countSpan.textContent = '0';
                }
            });

            // Populate Popular Tags
            const tagCounts = filters.tags || {};
            const sortedTags = Object.entries(tagCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20);

            if (sortedTags.length > 0) {
                popularTags.innerHTML = sortedTags.map(([tag, count]) => `
                    <button class="tech-search-tag" data-tag="${escapeHtml(tag)}">
                        ${escapeHtml(tag)}
                        <span style="opacity: 0.6;">(${count})</span>
                    </button>
                `).join('');

                // Add click handlers
                popularTags.querySelectorAll('.tech-search-tag').forEach(tagBtn => {
                    tagBtn.addEventListener('click', () => {
                        const tag = tagBtn.dataset.tag;

                        if (selectedTag === tag) {
                            selectedTag = null;
                            tagBtn.classList.remove('active');
                        } else {
                            selectedTag = tag;
                            popularTags.querySelectorAll('.tech-search-tag').forEach(t => t.classList.remove('active'));
                            tagBtn.classList.add('active');
                        }

                        currentPage = 1;
                        performSearch();
                    });
                });
            } else {
                popularTags.innerHTML = '<span class="tech-search-hint">No tags available</span>';
            }
        } catch (err) {
            console.warn("Could not load filters from Pagefind", err);
        }
    }

    /**
     * Perform search with current filters
     */
    async function performSearch() {
        showLoading();

        try {
            // Build filter object for Pagefind
            const filterObj = {};

            if (selectedCategories.length > 0) {
                filterObj.categories = {
                    any: selectedCategories
                };
            }

            if (selectedTag) {
                filterObj.tags = selectedTag;
            }

            // Build sort configuration
            // Pagefind supports sorting by attributes if indexed.
            // For now, we manually sort the mapped result objects, or rely on Pagefind relevance.
            let sortObj = undefined; // 'relevance' handles default sorting

            // Run search
            let searchResult = null;
            if (currentQuery) {
                searchResult = await pagefind.search(currentQuery, { filters: filterObj, sort: sortObj });
            } else {
                searchResult = await pagefind.search(null, { filters: filterObj, sort: sortObj });
            }

            // Map all results to data early so we can sort them client-side if needed (Pagefind handles relevance)
            // Note: For very large sets (e.g. 5000), fetching all .data() might be slow. 
            // A more optimized approach in a real SPA is paginating the requests, but we'll fetch them for sorting.
            // If sort is disabled, we could just slice the results and call data() on the page.

            let allResults = [];

            // To prevent massive load times when clicking empty search, we'll cap to 500 max results to process.
            const resultsToProcess = searchResult.results.slice(0, 500);
            allResults = await Promise.all(resultsToProcess.map(r => r.data()));

            // Apply manual sorting
            filteredResults = sortResults(allResults, currentSort);

            currentPage = 1;
            displayResults();
            updatePagination();

        } catch (err) {
            console.error("Error during Pagefind search:", err);
            showError("An error occurred while searching.");
        }
    }

    /**
     * Sort results
     */
    function sortResults(results, sortType) {
        const sorted = [...results];

        switch (sortType) {
            case 'date-newest':
                sorted.sort((a, b) => new Date(b.meta?.date || 0) - new Date(a.meta?.date || 0));
                break;
            case 'date-oldest':
                sorted.sort((a, b) => new Date(a.meta?.date || 0) - new Date(b.meta?.date || 0));
                break;
            case 'title':
                sorted.sort((a, b) => (a.meta?.title || "").localeCompare(b.meta?.title || ""));
                break;
            case 'relevance':
            default:
                // Keep Pagefind score ordering
                break;
        }

        return sorted;
    }

    /**
     * Display results
     */
    function displayResults() {
        if (filteredResults.length === 0) {
            showEmptyState();
            return;
        }

        // Update title
        if (currentQuery) {
            resultsTitle.textContent = `Results for "${escapeHtml(currentQuery)}"`;
        } else if (selectedTag) {
            resultsTitle.textContent = `Tagged with "${selectedTag}"`;
        } else {
            resultsTitle.textContent = 'All Articles';
        }

        // Paginate
        const startIndex = (currentPage - 1) * resultsPerPage;
        const endIndex = startIndex + resultsPerPage;
        const pageResults = filteredResults.slice(startIndex, endIndex);

        // Render results
        const html = pageResults.map(item => createResultCard(item)).join('');
        resultsContainer.innerHTML = html;
        searchPagination.style.display = 'flex';
    }

    /**
     * Create result card HTML
     */
    function createResultCard(item) {
        const category = item.meta?.categories || 'Article';
        const title = item.meta?.title || item.url || 'Untitled';
        const excerpt = getExcerpt(item);
        const iconPath = getCategoryIconPath(category);
        const date = item.meta?.date;
        const tags = Array.isArray(item.meta?.tags) ? item.meta.tags :
            (item.meta?.tags ? [item.meta.tags] : []);

        return `
            <article class="tech-search-result-card">
                <div class="tech-search-result-card-header">
                    <div class="tech-search-result-card-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            ${iconPath}
                        </svg>
                    </div>
                    <div class="tech-search-result-card-title">
                        <a href="${item.url}">${escapeHtml(title)}</a>
                        <div class="tech-search-result-card-category">${escapeHtml(category)}</div>
                    </div>
                </div>
                ${excerpt ? `<p class="tech-search-result-card-excerpt">${excerpt}</p>` : ''}
                <div class="tech-search-result-card-footer">
                    <div class="tech-search-result-card-tags">
                        ${tags.slice(0, 5).map(tag =>
            `<span class="tech-search-result-card-tag">${escapeHtml(tag)}</span>`
        ).join('')}
                    </div>
                    <div class="tech-search-result-card-meta">
                        ${date ? formatDate(date) : ''}
                    </div>
                </div>
            </article>
        `;
    }

    /**
     * Get excerpt from item
     */
    function getExcerpt(item) {
        const summary = item.excerpt || item.content || '';
        if (!summary) return '';

        const cleanSummary = summary.replace(/<[^>]*>/g, '');
        return cleanSummary.length > 180
            ? cleanSummary.substring(0, 180) + '...'
            : cleanSummary;
    }

    /**
     * Get category icon path
     */
    function getCategoryIconPath(category) {
        const icons = {
            'Comparisons': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
            'Integrations': '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
            'Troubleshooting': '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
            'Guides': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'
        };
        return icons[category] || '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>';
    }

    /**
     * Format date
     */
    function formatDate(dateStr) {
        if (!dateStr) return '';

        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;

        const options = { year: 'numeric', month: 'short', day: 'numeric' };
        return date.toLocaleDateString('en-US', options);
    }

    /**
     * Update pagination controls
     */
    function updatePagination() {
        const totalPages = Math.ceil(filteredResults.length / resultsPerPage) || 1;
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;

        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
    }

    /**
     * Show loading state
     */
    function showLoading() {
        resultsContainer.innerHTML = `
            <div class="tech-search-loading-state">
                <div class="tech-spinner-large"></div>
                <p>Loading internal pages...</p>
            </div>
        `;
        searchPagination.style.display = 'none';
    }

    /**
     * Show empty state
     */
    function showEmptyState() {
        resultsContainer.innerHTML = `
            <div class="tech-search-empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <h3>No results found</h3>
                <p>Try adjusting your search or filters to find what you're looking for.</p>
            </div>
        `;
        searchPagination.style.display = 'none';
    }

    /**
     * Show error state
     */
    function showError(message) {
        resultsContainer.innerHTML = `
            <div class="tech-search-empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <h3>Error</h3>
                <p>${escapeHtml(message)}</p>
            </div>
        `;
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Search input
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentQuery = searchInput.value.trim();
                clearBtn.style.display = currentQuery ? 'flex' : 'none';
                currentPage = 1;
                performSearch();
            }, 300);
        });

        // Clear button
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            currentQuery = '';
            clearBtn.style.display = 'none';
            currentPage = 1;
            performSearch();
            searchInput.focus();
        });

        // Category filters
        categoryFilters.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') {
                const checkboxes = categoryFilters.querySelectorAll('input[type="checkbox"]');
                selectedCategories = Array.from(checkboxes)
                    .filter(cb => cb.checked)
                    .map(cb => cb.value);
                currentPage = 1;
                performSearch();
            }
        });

        // Sort select
        sortSelect.addEventListener('change', () => {
            currentSort = sortSelect.value;
            currentPage = 1;
            performSearch();
        });

        // Pagination
        prevPageBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                displayResults();
                updatePagination();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });

        nextPageBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredResults.length / resultsPerPage);
            if (currentPage < totalPages) {
                currentPage++;
                displayResults();
                updatePagination();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }

    /**
     * Escape HTML
     */
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
