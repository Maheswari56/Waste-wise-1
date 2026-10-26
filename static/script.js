/* ==========================================================
   WasteWise — Premium SaaS Environmental Dashboard Logic
   ========================================================== */

let isAdmin = false;
let allReports = [];
let searchTimeout = null;

// Chart.js instances
let trendChartInstance = null;
let categoryChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    checkAdminStatus();
    loadDashboardStats();
    loadReports();
    setupFormSubmission();
    setupDragAndDrop();
});

/* ================= 1. Admin Authentication ================= */
async function checkAdminStatus() {
    try {
        const res = await fetch('/api/admin/status');
        const data = await res.json();
        isAdmin = data.is_admin;
        updateAdminUI();
    } catch (e) {
        console.error('Failed to check admin status:', e);
    }
}

function updateAdminUI() {
    const badge = document.getElementById('admin-indicator-badge');
    const badgeText = document.getElementById('admin-mode-text');
    const sidebarAdminText = document.getElementById('sidebar-admin-text');
    const sidebarBtn = document.getElementById('sidebar-admin-btn');
    const sidebarBtnLabel = document.getElementById('sidebar-btn-label');
    const sidebarUserState = document.getElementById('sidebar-user-state');
    const sidebarAvatarIcon = document.getElementById('sidebar-avatar-icon');

    if (isAdmin) {
        if (badge) {
            badge.style.background = '#ECFDF5';
            badge.style.color = '#065F46';
            badge.style.borderColor = '#A7F3D0';
        }
        if (badgeText) badgeText.textContent = 'Admin Mode (Status Editing Enabled)';
        if (sidebarAdminText) sidebarAdminText.textContent = 'Admin (Active)';
        if (sidebarBtn) {
            sidebarBtn.classList.add('active');
            sidebarBtn.onclick = logoutAdmin;
        }
        if (sidebarBtnLabel) sidebarBtnLabel.textContent = 'Logout Admin';
        if (sidebarUserState) sidebarUserState.textContent = 'Administrator (Active)';
        if (sidebarAvatarIcon) sidebarAvatarIcon.innerHTML = '<i class="fa-solid fa-user-check"></i>';
    } else {
        if (badge) {
            badge.style.background = '';
            badge.style.color = '';
            badge.style.borderColor = '';
        }
        if (badgeText) badgeText.textContent = 'Public Citizen View';
        if (sidebarAdminText) sidebarAdminText.textContent = 'Demo Admin';
        if (sidebarBtn) {
            sidebarBtn.classList.remove('active');
            sidebarBtn.onclick = openAdminModal;
        }
        if (sidebarBtnLabel) sidebarBtnLabel.textContent = 'Demo Admin Login';
        if (sidebarUserState) sidebarUserState.textContent = 'Public Citizen View';
        if (sidebarAvatarIcon) sidebarAvatarIcon.innerHTML = '<i class="fa-solid fa-user-shield"></i>';
    }
    renderReportsTable(allReports);
}

function handleAdminButtonClick() {
    if (isAdmin) {
        logoutAdmin();
    } else {
        openAdminModal();
    }
}

function openAdminModal() {
    const modal = document.getElementById('admin-modal');
    const errorBox = document.getElementById('admin-error-msg');
    if (errorBox) errorBox.classList.add('hidden');
    const passInput = document.getElementById('admin-passcode-input');
    if (passInput) passInput.value = '';
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => passInput && passInput.focus(), 100);
    }
}

function closeAdminModal() {
    const modal = document.getElementById('admin-modal');
    if (modal) modal.classList.add('hidden');
}

async function submitAdminLogin() {
    const passInput = document.getElementById('admin-passcode-input');
    const errorBox = document.getElementById('admin-error-msg');
    const passcode = passInput ? passInput.value.trim() : '';

    if (!passcode) {
        if (errorBox) {
            errorBox.textContent = 'Please enter passcode.';
            errorBox.classList.remove('hidden');
        }
        return;
    }

    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passcode })
        });
        const data = await res.json();
        if (data.success) {
            isAdmin = true;
            closeAdminModal();
            updateAdminUI();
        } else {
            if (errorBox) {
                errorBox.textContent = data.message || 'Incorrect passcode.';
                errorBox.classList.remove('hidden');
            }
        }
    } catch (e) {
        if (errorBox) {
            errorBox.textContent = 'Connection error. Check backend server.';
            errorBox.classList.remove('hidden');
        }
    }
}

async function logoutAdmin() {
    try {
        await fetch('/api/admin/logout', { method: 'POST' });
        isAdmin = false;
        updateAdminUI();
    } catch (e) {
        console.error(e);
    }
}

/* ================= 2. Responsive Sidebar Navigation ================= */
function toggleMobileSidebar() {
    const sidebar = document.getElementById('saas-sidebar');
    if (sidebar) {
        sidebar.classList.toggle('mobile-open');
    }
}

function setActiveNav(navId) {
    const links = document.querySelectorAll('.sidebar-link');
    links.forEach(l => l.classList.remove('active'));
    const target = document.getElementById(navId);
    if (target) target.classList.add('active');

    // On mobile, auto close sidebar upon clicking a link
    if (window.innerWidth <= 900) {
        const sidebar = document.getElementById('saas-sidebar');
        if (sidebar) sidebar.classList.remove('mobile-open');
    }
}

function syncSearchWithTable(val) {
    const filterInput = document.getElementById('filter-search');
    if (filterInput) {
        filterInput.value = val;
        debounceSearch();
    }
}

/* ================= 3. Dashboard Statistics ================= */
async function loadDashboardStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        if (data.success) {
            document.getElementById('stat-total').textContent = data.total;
            document.getElementById('stat-pending').textContent = data.pending;
            document.getElementById('stat-in-progress').textContent = data.in_progress;
            document.getElementById('stat-resolved').textContent = data.resolved;
            const badgeCount = document.getElementById('sidebar-reports-count');
            if (badgeCount) badgeCount.textContent = data.total;
        }
    } catch (e) {
        console.error('Error loading stats:', e);
    }
}

/* ================= 4. Reports & Filter Logic ================= */
function debounceSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        loadReports();
    }, 280);
}

async function loadReports() {
    const searchInput = document.getElementById('filter-search');
    const catSelect = document.getElementById('filter-category');
    const statSelect = document.getElementById('filter-status');

    const search = searchInput ? searchInput.value.trim() : '';
    const category = catSelect ? catSelect.value : 'All';
    const status = statSelect ? statSelect.value : 'All';

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (category) params.append('category', category);
    if (status) params.append('status', status);

    try {
        const res = await fetch(`/api/reports?${params.toString()}`);
        const data = await res.json();
        if (data.success) {
            allReports = data.reports;
            renderReportsTable(allReports);
            updateChartsFromReports(allReports);
        }
    } catch (e) {
        console.error('Failed to load reports:', e);
    }
}

function renderReportsTable(reports) {
    const tbody = document.getElementById('reports-table-body');
    const emptyState = document.getElementById('empty-state');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!reports || reports.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    reports.forEach(report => {
        const tr = document.createElement('tr');

        // Status badge class
        let statusClass = 'status-pending';
        let statusIcon = '<i class="fa-regular fa-clock"></i>';
        if (report.status === 'In Progress') {
            statusClass = 'status-in-progress';
            statusIcon = '<i class="fa-solid fa-truck-fast"></i>';
        } else if (report.status === 'Resolved') {
            statusClass = 'status-resolved';
            statusIcon = '<i class="fa-regular fa-circle-check"></i>';
        }

        // Severity class
        let sevClass = 'severity-low';
        if (report.severity === 'Medium') sevClass = 'severity-medium';
        if (report.severity === 'High') sevClass = 'severity-high';

        // Photo thumbnail
        let photoHtml = '<span class="no-photo-text">No image</span>';
        if (report.photo_filename) {
            photoHtml = `<img src="/uploads/${encodeURIComponent(report.photo_filename)}" class="table-thumb-img" alt="Photo" onclick="viewPhotoModal('${encodeURIComponent(report.photo_filename)}')">`;
        }

        // Admin status control
        let statusDisplay = `<span class="badge-status-pill ${statusClass}">${statusIcon} ${escapeHtml(report.status)}</span>`;
        if (isAdmin) {
            statusDisplay += `
                <select class="admin-status-dropdown" onchange="changeReportStatus('${report.id}', this.value)">
                    <option value="Pending" ${report.status === 'Pending' ? 'selected' : ''}>Pending</option>
                    <option value="In Progress" ${report.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                    <option value="Resolved" ${report.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                </select>
            `;
        }

        const formattedDate = new Date(report.created_at).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        tr.innerHTML = `
            <td><span class="table-report-id">${escapeHtml(report.id)}</span></td>
            <td><b>${escapeHtml(report.category)}</b></td>
            <td title="${escapeHtml(report.location)}">${escapeHtml(report.location.length > 34 ? report.location.substring(0, 34) + '...' : report.location)}</td>
            <td><span class="badge-sev-tag ${sevClass}">${escapeHtml(report.severity)}</span></td>
            <td>${statusDisplay}</td>
            <td style="color: var(--text-muted); font-size: 0.8rem;">${formattedDate}</td>
            <td>${photoHtml}</td>
            <td>
                <button type="button" class="btn-view-report" onclick="showReportDetails('${report.id}')">
                    <i class="fa-regular fa-eye"></i> View
                </button>
            </td>
        `;

        tbody.appendChild(tr);
    });
}

async function changeReportStatus(reportId, newStatus) {
    try {
        const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (data.success) {
            loadDashboardStats();
            loadReports();
        } else {
            alert('Status update failed: ' + data.message);
        }
    } catch (e) {
        alert('Error updating status: ' + e.message);
    }
}

/* ================= 5. Data-Driven Charts (Chart.js) ================= */
function updateChartsFromReports(reports) {
    if (typeof Chart === 'undefined') return;

    // --- 1. Category Distribution Doughnut Chart ---
    const categoryCounts = {
        'Plastic': 0,
        'Food Waste': 0,
        'Electronic Waste': 0,
        'Medical Waste': 0,
        'General Waste': 0
    };

    reports.forEach(r => {
        if (categoryCounts.hasOwnProperty(r.category)) {
            categoryCounts[r.category]++;
        } else {
            categoryCounts['General Waste']++;
        }
    });

    const categoryLabels = Object.keys(categoryCounts);
    const categoryData = Object.values(categoryCounts);
    const totalReportsCount = reports.length;

    const categoryColors = [
        '#10B981', // Plastic: Emerald
        '#F59E0B', // Food Waste: Amber
        '#3B82F6', // Electronic Waste: Blue
        '#EF4444', // Medical Waste: Rose
        '#64748B'  // General Waste: Slate
    ];

    const ctxCat = document.getElementById('wasteCategoryChart');
    if (ctxCat) {
        if (categoryChartInstance) {
            categoryChartInstance.destroy();
        }

        categoryChartInstance = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
                labels: categoryLabels,
                datasets: [{
                    data: categoryData,
                    backgroundColor: categoryColors,
                    borderWidth: 2,
                    borderColor: '#FFFFFF',
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const val = context.raw || 0;
                                const pct = totalReportsCount > 0 ? ((val / totalReportsCount) * 100).toFixed(1) : 0;
                                return ` ${context.label}: ${val} (${pct}%)`;
                            }
                        }
                    }
                },
                cutout: '68%'
            }
        });

        // Update Legend List
        const legendList = document.getElementById('categoryLegendList');
        if (legendList) {
            legendList.innerHTML = '';
            categoryLabels.forEach((label, idx) => {
                const count = categoryData[idx];
                const pct = totalReportsCount > 0 ? ((count / totalReportsCount) * 100).toFixed(0) : 0;
                const row = document.createElement('div');
                row.className = 'legend-item-row';
                row.innerHTML = `
                    <div class="legend-label-col">
                        <span class="legend-color-dot" style="background:${categoryColors[idx]};"></span>
                        <span>${label}</span>
                    </div>
                    <span class="legend-val-col">${count} (${pct}%)</span>
                `;
                legendList.appendChild(row);
            });
        }
    }

    // --- 2. Reports Trend Area Chart ---
    // Generate dates for the last 7 calendar days
    const daysMap = {};
    const dayLabels = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const key = `${yyyy}-${mm}-${dd}`;
        const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        daysMap[key] = 0;
        dayLabels.push({ key, label });
    }

    reports.forEach(r => {
        if (r.created_at) {
            const datePrefix = r.created_at.substring(0, 10);
            if (daysMap.hasOwnProperty(datePrefix)) {
                daysMap[datePrefix]++;
            }
        }
    });

    const trendLabels = dayLabels.map(item => item.label);
    const trendValues = dayLabels.map(item => daysMap[item.key]);

    const ctxTrend = document.getElementById('reportsTrendChart');
    if (ctxTrend) {
        if (trendChartInstance) {
            trendChartInstance.destroy();
        }

        trendChartInstance = new Chart(ctxTrend, {
            type: 'line',
            data: {
                labels: trendLabels,
                datasets: [{
                    label: 'Reports Filed',
                    data: trendValues,
                    borderColor: '#10B981',
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2.5,
                    pointBackgroundColor: '#064E3B',
                    pointBorderColor: '#FFFFFF',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, color: '#64748B' },
                        grid: { color: '#F1F5F9' }
                    },
                    x: {
                        ticks: { color: '#64748B', font: { size: 11 } },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` Reports: ${ctx.raw}`
                        }
                    }
                }
            }
        });
    }
}

/* ================= 6. Details Modal & Full Photo Inspection ================= */
function showReportDetails(reportId) {
    const report = allReports.find(r => r.id === reportId);
    if (!report) return;

    document.getElementById('modal-report-id').textContent = `Report: ${report.id}`;
    const modalBody = document.getElementById('modal-report-body');

    let photoTag = '';
    if (report.photo_filename) {
        photoTag = `
            <div class="report-detail-row">
                <div class="report-detail-label">Attached Evidence:</div>
                <img src="/uploads/${encodeURIComponent(report.photo_filename)}" class="report-modal-img" alt="Waste photo">
            </div>
        `;
    }

    const createdFormatted = new Date(report.created_at).toLocaleString();

    modalBody.innerHTML = `
        <div class="report-detail-row">
            <div class="report-detail-label">Reporter Name:</div>
            <div class="report-detail-val">${escapeHtml(report.reporter_name)}</div>
        </div>
        <div class="report-detail-row">
            <div class="report-detail-label">Category & Severity:</div>
            <div class="report-detail-val"><b>${escapeHtml(report.category)}</b> &bull; Severity: <span class="badge-sev-tag severity-${report.severity.toLowerCase()}">${escapeHtml(report.severity)}</span></div>
        </div>
        <div class="report-detail-row">
            <div class="report-detail-label">Current Status:</div>
            <div class="report-detail-val"><b>${escapeHtml(report.status)}</b></div>
        </div>
        <div class="report-detail-row">
            <div class="report-detail-label">Location:</div>
            <div class="report-detail-val"><i class="fa-solid fa-location-dot" style="color:#10b981;"></i> ${escapeHtml(report.location)}</div>
        </div>
        <div class="report-detail-row">
            <div class="report-detail-label">Description:</div>
            <div class="report-detail-val" style="white-space: pre-wrap; background: #f8fafc; padding: 0.75rem; border-radius: 8px; border: 1px solid #e2e8f0;">${escapeHtml(report.description)}</div>
        </div>
        <div class="report-detail-row">
            <div class="report-detail-label">Logged At:</div>
            <div class="report-detail-val" style="color: #64748b; font-size: 0.85rem;">${createdFormatted}</div>
        </div>
        ${photoTag}
    `;

    document.getElementById('details-modal').classList.remove('hidden');
}

function viewPhotoModal(filename) {
    document.getElementById('modal-report-id').textContent = 'Attached Evidence Photo';
    const modalBody = document.getElementById('modal-report-body');
    modalBody.innerHTML = `<img src="/uploads/${filename}" class="report-modal-img" alt="Evidence">`;
    document.getElementById('details-modal').classList.remove('hidden');
}

function closeDetailsModal() {
    document.getElementById('details-modal').classList.add('hidden');
}

/* ================= 7. Waste Report Form Submission ================= */
function setupFormSubmission() {
    const form = document.getElementById('waste-report-form');
    const submitBtn = document.getElementById('submit-btn');
    const notifBox = document.getElementById('form-notification');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';
        notifBox.className = 'notification-box hidden';

        const formData = new FormData(form);

        try {
            const res = await fetch('/api/reports', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (data.success) {
                notifBox.className = 'notification-box success';
                notifBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> <div><b>Success!</b> Report submitted with Reference ID: <b>${data.report_id}</b>.</div>`;
                form.reset();
                clearImageUpload();
                loadDashboardStats();
                loadReports();
                notifBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                notifBox.className = 'notification-box error';
                notifBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <div><b>Submission Failed:</b> ${data.message}</div>`;
            }
        } catch (err) {
            notifBox.className = 'notification-box error';
            notifBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <div><b>Network Error:</b> Could not reach backend server.</div>`;
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Waste Report';
        }
    });
}

/* ================= 8. Drag & Drop Photo Upload ================= */
function setupDragAndDrop() {
    const dropArea = document.getElementById('drop-area');
    if (!dropArea) return;

    ['dragenter', 'dragover'].forEach(name => {
        dropArea.addEventListener(name, (e) => {
            e.preventDefault();
            dropArea.classList.add('drag-active');
        }, false);
    });

    ['dragleave', 'drop'].forEach(name => {
        dropArea.addEventListener(name, (e) => {
            e.preventDefault();
            dropArea.classList.remove('drag-active');
        }, false);
    });

    dropArea.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length) {
            document.getElementById('photo').files = files;
            previewFile(document.getElementById('photo'));
        }
    });
}

function previewFile(input) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        if (file.size > 8 * 1024 * 1024) {
            alert('File size exceeds 8MB. Please choose a smaller image.');
            clearImageUpload();
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('image-preview').src = e.target.result;
            document.getElementById('drop-content').classList.add('hidden');
            document.getElementById('preview-box').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
}

function clearImageUpload() {
    const photoInput = document.getElementById('photo');
    if (photoInput) photoInput.value = '';
    const imgPreview = document.getElementById('image-preview');
    if (imgPreview) imgPreview.src = '#';
    const dropContent = document.getElementById('drop-content');
    if (dropContent) dropContent.classList.remove('hidden');
    const previewBox = document.getElementById('preview-box');
    if (previewBox) previewBox.classList.add('hidden');
}

/* ================= 9. Geolocation & Reverse Geocoding ================= */
function setLocationHint(text, type = 'info') {
    const hint = document.getElementById('location-hint');
    if (!hint) return;
    if (!text) {
        hint.textContent = '';
        hint.className = 'location-hint hidden';
        return;
    }
    hint.className = `location-hint ${type}`;
    hint.innerHTML = text;
}

function detectLocation() {
    const locInput = document.getElementById('location');
    const detectBtn = document.getElementById('btn-detect-geo');
    const detectText = document.getElementById('btn-detect-text');

    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
    }

    if (detectBtn) detectBtn.disabled = true;
    if (detectText) detectText.textContent = 'Detecting...';
    locInput.value = '';
    locInput.placeholder = 'Acquiring GPS position...';
    setLocationHint('<i class="fa-solid fa-spinner fa-spin"></i> Acquiring GPS coordinates...', 'loading');

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const lat = Number(pos.coords.latitude.toFixed(5));
            const lon = Number(pos.coords.longitude.toFixed(5));
            const fallbackGPS = `GPS: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;

            locInput.placeholder = 'Resolving street address...';
            setLocationHint('<i class="fa-solid fa-spinner fa-spin"></i> Converting GPS coordinates to address...', 'loading');

            try {
                const res = await fetch(`/api/geocode/reverse?lat=${lat}&lon=${lon}`);
                const data = await res.json();

                if (data.success && data.address) {
                    locInput.value = data.address;
                    setLocationHint(
                        `<i class="fa-solid fa-circle-check" style="color:#059669;"></i> Address resolved (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
                        'success'
                    );
                } else {
                    locInput.value = fallbackGPS;
                    setLocationHint(
                        `<i class="fa-solid fa-triangle-exclamation" style="color:#d97706;"></i> Reverse geocoding unavailable: saved as GPS coordinates.`,
                        'warning'
                    );
                }
            } catch (err) {
                locInput.value = fallbackGPS;
                setLocationHint(
                    `<i class="fa-solid fa-triangle-exclamation" style="color:#d97706;"></i> Network issue: saved as GPS coordinates (${fallbackGPS}).`,
                    'warning'
                );
            } finally {
                if (detectBtn) detectBtn.disabled = false;
                if (detectText) detectText.textContent = 'Detect';
                locInput.placeholder = 'e.g. 5th Cross Road, Near Green Park Metro Station';
            }
        },
        (err) => {
            if (detectBtn) detectBtn.disabled = false;
            if (detectText) detectText.textContent = 'Detect';
            locInput.placeholder = 'e.g. 5th Cross Road, Near Green Park Metro Station';

            let errorMsg = 'Unable to retrieve location.';
            if (err.code === 1) {
                errorMsg = 'Location permission denied. Please allow location access in browser settings.';
            } else if (err.code === 2) {
                errorMsg = 'Location unavailable. Your GPS or network signal could not be determined.';
            } else if (err.code === 3) {
                errorMsg = 'Location request timed out. Please try again.';
            }
            setLocationHint(`<i class="fa-solid fa-circle-exclamation" style="color:#dc2626;"></i> ${escapeHtml(errorMsg)}`, 'error');
            alert(errorMsg);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
}

/* ================= 10. AI Assistant Chat Interface ================= */
let latestAiCategory = '';

async function runAiAnalysis() {
    const inputField = document.getElementById('ai-query-input');
    const query = inputField ? inputField.value.trim() : '';

    if (!query) {
        alert('Please describe a waste item for the AI assistant.');
        return;
    }

    const threadBox = document.getElementById('chat-thread-box');
    const emptyHero = document.getElementById('chat-empty-state');
    if (emptyHero) emptyHero.remove();

    // 1. Append User Message Bubble
    appendChatBubble('user', query);
    inputField.value = '';

    // 2. Append Loading Assistant Bubble
    const loadingBubbleId = 'ai-loading-' + Date.now();
    appendChatBubble('ai-loading', '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing waste properties & environmental hazards...', loadingBubbleId);

    const btn = document.getElementById('ai-analyze-btn');
    if (btn) btn.disabled = true;

    try {
        const res = await fetch('/api/ai/categorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: query })
        });
        const resp = await res.json();

        // Remove loading bubble
        const loadingElem = document.getElementById(loadingBubbleId);
        if (loadingElem) loadingElem.remove();

        if (resp.success) {
            const data = resp.data;
            latestAiCategory = data.category;

            const contentHtml = `
                <div class="ai-category-badge">
                    <i class="fa-solid fa-tag"></i> Suggested: <b>${escapeHtml(data.category)}</b>
                </div>
                <div class="ai-bubble-section">
                    <h5><i class="fa-solid fa-circle-check"></i> Safe Handling & Disposal:</h5>
                    <p>${escapeHtml(data.disposal_guidance)}</p>
                </div>
                <div class="ai-bubble-section" style="margin-top:0.45rem;">
                    <h5><i class="fa-solid fa-biohazard"></i> Ecological & Health Hazards:</h5>
                    <p>${escapeHtml(data.environmental_risks)}</p>
                </div>
                <button type="button" class="btn-apply-category-inline" onclick="applyAiCategoryDirectly('${escapeHtml(data.category)}')">
                    <i class="fa-solid fa-arrow-left"></i> Apply "${escapeHtml(data.category)}" to Report Form
                </button>
            `;
            appendChatBubble('ai', contentHtml);
        } else {
            appendChatBubble('ai', `<span style="color:#DC2626;">Error: ${escapeHtml(resp.message)}</span>`);
        }
    } catch (e) {
        const loadingElem = document.getElementById(loadingBubbleId);
        if (loadingElem) loadingElem.remove();
        appendChatBubble('ai', `<span style="color:#DC2626;">Could not reach backend AI service: ${escapeHtml(e.message)}</span>`);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function appendChatBubble(sender, htmlContent, elementId = '') {
    const threadBox = document.getElementById('chat-thread-box');
    if (!threadBox) return;

    const row = document.createElement('div');
    row.className = `chat-bubble-row ${sender === 'user' ? 'user-row' : 'ai-row'}`;
    if (elementId) row.id = elementId;

    let avatarIcon = sender === 'user' ? '<i class="fa-regular fa-user"></i>' : '<i class="fa-solid fa-robot"></i>';

    row.innerHTML = `
        <div class="chat-avatar-mini">${avatarIcon}</div>
        <div class="chat-bubble">${htmlContent}</div>
    `;

    threadBox.appendChild(row);
    threadBox.scrollTop = threadBox.scrollHeight;
}

function askAiFromForm() {
    const formDesc = document.getElementById('description').value.trim();
    if (!formDesc) {
        alert('Please first write a brief description in the description box.');
        document.getElementById('description').focus();
        return;
    }
    const aiInput = document.getElementById('ai-query-input');
    if (aiInput) aiInput.value = formDesc;
    document.getElementById('ai-assistant-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
    runAiAnalysis();
}

function applyAiCategoryDirectly(cat) {
    const catSelect = document.getElementById('category');
    if (catSelect) {
        catSelect.value = cat;
        document.getElementById('report-section').scrollIntoView({ behavior: 'smooth' });
        catSelect.style.borderColor = '#10B981';
        setTimeout(() => catSelect.style.borderColor = '', 1500);
    }
}

/* Helper to prevent XSS */
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}
