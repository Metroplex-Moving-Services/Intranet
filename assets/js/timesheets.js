/* ============================================================
   assets/js/timesheets.js
   Description: Groups timesheets by Mon-Sun weeks with pagination
   ============================================================ */

const sdk = Descope({ projectId: 'P2qXQxJA4H4hvSu2AnDB5VjKnh1d', persistTokens: true });
const NETLIFY_PAYOUTS_ENDPOINT = "/.netlify/functions/get-payouts";

let allWeeks = []; 
let currentPage = 1;
const WEEKS_PER_PAGE = 4;

document.addEventListener('DOMContentLoaded', async function() {
    const sessionToken = sdk.getSessionToken();
    if (!sessionToken || sdk.isJwtExpired(sessionToken)) {
        window.top.location.href = "/Intranet/login.html";
    } else {
        try {
            const userProfile = await sdk.me();
            const email = userProfile.data.email || userProfile.data.loginIds[0];
            if (email) {
                window.currentUserEmail = email; 
                window.currentToken = sessionToken;
                loadTimesheetsData();
            } else {
                throw new Error("Could not find your email address.");
            }
        } catch (err) {
            document.getElementById('loading').style.display = 'none'; // Hide loader on error
            document.getElementById('error-container').innerHTML = `<div class="error-msg">Auth Error: ${err.message}</div>`;
        }
    }
});

async function loadTimesheetsData() {
    const loader = document.getElementById('loading');
    const table = document.getElementById('timesheet-table');
    const tableBody = document.getElementById('timesheet-body');
    const noDataMsg = document.getElementById('no-data');
    const errorContainer = document.getElementById('error-container');
    const pagination = document.getElementById('pagination');

    // Reset UI
    loader.style.display = 'block';
    table.style.display = 'none';
    noDataMsg.style.display = 'none';
    pagination.style.display = 'none';
    errorContainer.innerHTML = '';
    
    try {
        const response = await fetch(NETLIFY_PAYOUTS_ENDPOINT, {
            headers: { 
                'Authorization': `Bearer ${window.currentToken}`,
                'X-User-Email': window.currentUserEmail 
            }
        });
        
        if (!response.ok) throw new Error(await response.text());
        
        const json = await response.json();
        const records = json.data || [];

        if (records.length === 0) {
            noDataMsg.style.display = 'block';
        } else {
            allWeeks = groupJobsByWeek(records);
            currentPage = 1;
            renderPage();
            // Show table ONLY after rendering
            table.style.display = 'table';
        }
    } catch (err) {
        console.error("Timesheet Error:", err);
        errorContainer.innerHTML = `<div class="error-msg">Error loading timesheets: ${err.message}</div>`;
    } finally {
        loader.style.display = 'none';
    }
}

/* --- GROUPING LOGIC (Same as before) --- */
function groupJobsByWeek(jobs) {
    const groups = {};

    jobs.forEach(job => {
        if (!job.Job_Date) return;
        
        const d = new Date(job.Job_Date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        
        const monday = new Date(d.setDate(diff));
        monday.setHours(0,0,0,0);
        const weekKey = monday.toISOString().split('T')[0];

        if (!groups[weekKey]) {
            groups[weekKey] = {
                startDate: monday,
                jobs: [],
                totalHours: 0,
                totalPayout: 0
            };
        }

        groups[weekKey].jobs.push(job);

        const worked = parseFloat(job.MoverTimeWorked) || 0;
        const p = parseMoney(job.Payout).val;
        const t = parseMoney(job.Tip).val;
        const e = parseMoney(job.Extra).val;
        const totalPay = p + t + e;

        groups[weekKey].totalHours += worked;
        groups[weekKey].totalPayout += totalPay;
    });

    const sortedWeeks = Object.values(groups).sort((a, b) => b.startDate - a.startDate);

    sortedWeeks.forEach(week => {
        week.jobs.sort((a, b) => new Date(b.Job_Date) - new Date(a.Job_Date));
    });

    return sortedWeeks;
}

/* --- RENDERING LOGIC --- */
function renderPage() {
    const tableBody = document.getElementById('timesheet-body');
    const pagination = document.getElementById('pagination');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const indicator = document.getElementById('page-indicator');

    tableBody.innerHTML = '';

    const start = (currentPage - 1) * WEEKS_PER_PAGE;
    const end = start + WEEKS_PER_PAGE;
    const weeksToRender = allWeeks.slice(start, end);

    weeksToRender.forEach(week => {
        // A. Week Header
        const headerRow = document.createElement('tr');
        headerRow.className = "week-header-row";
        const endDate = new Date(week.startDate);
        endDate.setDate(endDate.getDate() + 6); 
        
        const rangeStr = `${formatDateShort(week.startDate)} - ${formatDateShort(endDate)}`;
        
        // We set colspan to a high number to span all columns in both views
        headerRow.innerHTML = `<td colspan="15">Week of: ${rangeStr}</td>`;
        tableBody.appendChild(headerRow);

        // B. Job Rows
        week.jobs.forEach(job => {
            const tr = document.createElement('tr');
            
            const p = parseMoney(job.Payout);
            const t = parseMoney(job.Tip);
            const e = parseMoney(job.Extra);
            const totalPay = p.val + t.val + e.val;
            
            // NOTE: Only ONE "Job Date" column per view type to avoid duplication
            tr.innerHTML = `
                <td class="ts-col-mobile">
                    <div>${formatDateShort(job.Job_Date)}</div>
                    <small class="text-muted">${formatTime(job.MoverStartTime)}</small>
                </td>
                <td class="ts-col-mobile">${job.CalculatedMiles || 0}</td>
                <td class="ts-col-mobile">${(parseFloat(job.MoverTimeWorked)||0).toFixed(2)}</td>
                <td class="ts-col-mobile money" style="text-align:right;">${formatMoney(totalPay)}</td>

                <td class="ts-col-desktop">${formatDateShort(job.Job_Date)} ${formatTime(job.MoverStartTime)}</td>
                <td class="ts-col-desktop">${getZohoName(job.Customer_Name)}</td>
                <td class="ts-col-desktop">${job.CalculatedMiles || 0}</td>
                <td class="ts-col-desktop">${formatTime(job.MoverStartTime)}</td>
                <td class="ts-col-desktop">${formatTime(job.MoverEndtime)}</td>
                <td class="ts-col-desktop">${(parseFloat(job.MoverTimeWorked)||0).toFixed(2)}</td>
                <td class="ts-col-desktop">${(parseFloat(job.Job_Duration)||0).toFixed(2)}</td>
                <td class="ts-col-desktop">${p.text}</td>
                <td class="ts-col-desktop">${t.text}</td>
                <td class="ts-col-desktop">${e.text}</td>
            `;
            tableBody.appendChild(tr);
        });

        // C. Weekly Summary Row
        const summaryRow = document.createElement('tr');
        summaryRow.className = "week-summary-row";
        summaryRow.innerHTML = `
            <td class="ts-col-mobile" colspan="3" style="text-align:right; font-size:0.9em;">
                Hrs: ${week.totalHours.toFixed(2)} | Total:
            </td>
            <td class="ts-col-mobile money" style="text-align:right;">${formatMoney(week.totalPayout)}</td>

            <td class="ts-col-desktop" colspan="9" style="text-align:right;">Weekly Totals (${week.totalHours.toFixed(2)} hrs):</td>
            <td class="ts-col-desktop money" style="font-size:1.1em;">${formatMoney(week.totalPayout)}</td>
        `;
        tableBody.appendChild(summaryRow);
    });

    pagination.style.display = allWeeks.length > 0 ? 'flex' : 'none';
    const totalPages = Math.ceil(allWeeks.length / WEEKS_PER_PAGE);
    
    indicator.innerText = `Page ${currentPage} of ${totalPages}`;
    btnPrev.disabled = currentPage === 1;
    btnNext.disabled = currentPage >= totalPages;

    btnPrev.onclick = () => { if(currentPage > 1) { currentPage--; renderPage(); }};
    btnNext.onclick = () => { if(currentPage < totalPages) { currentPage++; renderPage(); }};
}

/* --- HELPERS --- */
function getZohoName(field) {
    if (!field) return "-";
    if (typeof field === 'object') return field.last_name || ""; 
    return field; 
}

function formatDateShort(dateInput) {
    if (!dateInput) return "";
    const d = new Date(dateInput);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(timeStr) {
    if (!timeStr) return "";
    const d = new Date(timeStr);
    if (isNaN(d.getTime())) {
        return timeStr.split(' ')[1] || timeStr; 
    }
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function parseMoney(val) {
    if (!val) return { val: 0, text: "$0.00" };
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g,""));
    return { val: (isNaN(num) ? 0 : num), text: val };
}

function formatMoney(num) {
    return "$" + num.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}