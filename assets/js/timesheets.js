/* ============================================================
   assets/js/timesheets.js
   Description: Groups timesheets with DETAILED split for Desktop
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
            document.getElementById('loading').style.display = 'none';
            document.getElementById('error-container').innerHTML = `<div class="error-msg">Auth Error: ${err.message}</div>`;
        }
    }
});

async function loadTimesheetsData() {
    const loader = document.getElementById('loading');
    const table = document.getElementById('timesheet-table');
    const noDataMsg = document.getElementById('no-data');
    const errorContainer = document.getElementById('error-container');
    const pagination = document.getElementById('pagination');

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
            table.style.display = 'table';
        }
    } catch (err) {
        console.error("Timesheet Error:", err);
        errorContainer.innerHTML = `<div class="error-msg">Error loading timesheets: ${err.message}</div>`;
    } finally {
        loader.style.display = 'none';
    }
}

/* --- GROUPING LOGIC --- */
function groupJobsByWeek(jobs) {
    const groups = {};

    jobs.forEach(job => {
        if (!job.Job_Date) return;
        
        const d = new Date(job.Job_Date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
        
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

        // Summaries for the week header
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
        // Colspan = 4 (Mobile) + 11 (Desktop) roughly, set high number to be safe
        headerRow.innerHTML = `<td colspan="15">Week of: ${rangeStr}</td>`;
        tableBody.appendChild(headerRow);

        // B. Job Rows
        week.jobs.forEach(job => {
            const tr = document.createElement('tr');
            
            // 1. Core Data
            const workedHours = parseFloat(job.MoverTimeWorked) || 0;
            const miles = parseFloat(job.CalculatedMiles) || 0;
            const tipVal = parseMoney(job.Tip).val;
            const extraVal = parseMoney(job.Extra).val;
            
            // 2. Parse Payout String to get Rates
            // Format: "(... - 15) * 0.6 + (5.5 * 18.0)"
            const rates = parsePayoutRates(job.PayoutCalculation);
            
            // 3. Calculate Visual Splits
            const laborPay = workedHours * rates.hourlyRate;
            const mileagePay = miles * rates.mileageRate;
            const totalPay = laborPay + mileagePay + tipVal + extraVal;
            
            // 4. Formatting
            const clockedInStr = `${formatDateShort(job.Job_Date)}, ${formatTime(job.MoverStartTime)}`;
            
            tr.innerHTML = `
                <td class="ts-col-mobile">
                    <strong>${formatDateShort(job.Job_Date)}</strong><br>
                    <small>${formatTime(job.MoverStartTime)}</small>
                </td>
                <td class="ts-col-mobile">${miles}</td>
                <td class="ts-col-mobile">${workedHours.toFixed(2)}</td>
                <td class="ts-col-mobile text-right money">
                    ${formatMoney(totalPay)}
                </td>

                <td class="ts-col-desktop">${clockedInStr}</td>
                <td class="ts-col-desktop">${getZohoName(job.Customer_Name)}</td>
                
                <td class="ts-col-desktop text-right">${workedHours.toFixed(2)}</td>
                <td class="ts-col-desktop text-right">$${rates.hourlyRate.toFixed(2)}</td>
                <td class="ts-col-desktop text-right money">${formatMoney(laborPay)}</td>
                
                <td class="ts-col-desktop text-right">${miles}</td>
                <td class="ts-col-desktop text-right">$${rates.mileageRate.toFixed(2)}</td>
                <td class="ts-col-desktop text-right money">${formatMoney(mileagePay)}</td>
                
                <td class="ts-col-desktop text-right">${tipVal > 0 ? formatMoney(tipVal) : '-'}</td>
                <td class="ts-col-desktop text-right">${extraVal > 0 ? formatMoney(extraVal) : '-'}</td>
                
                <td class="ts-col-desktop text-right money" style="font-weight:bold;">${formatMoney(totalPay)}</td>
            `;
            tableBody.appendChild(tr);
        });

        // C. Weekly Summary Row
        const summaryRow = document.createElement('tr');
        summaryRow.className = "week-summary-row";
        
        summaryRow.innerHTML = `
            <td class="ts-col-mobile" colspan="2" class="text-right">Weekly Totals:</td>
            <td class="ts-col-mobile">${week.totalHours.toFixed(2)}</td>
            <td class="ts-col-mobile text-right money">${formatMoney(week.totalPayout)}</td>

            <td class="ts-col-desktop" colspan="2" class="text-right">Weekly Totals:</td>
            
            <td class="ts-col-desktop text-right" style="font-weight:bold;">${week.totalHours.toFixed(2)}</td>
            <td class="ts-col-desktop" colspan="7"></td> <td class="ts-col-desktop text-right money" style="font-weight:bold;">${formatMoney(week.totalPayout)}</td>
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

/* --- PARSING HELPERS --- */

// Extracts rates from string: "(... - 15) * 0.6 + (5.5 * 18.0)"
function parsePayoutRates(calcString) {
    let result = { mileageRate: 0, hourlyRate: 0 };
    if (!calcString || typeof calcString !== 'string') return result;

    try {
        // Split by " + (" to separate [Mileage Logic] from [Labor Logic]
        const parts = calcString.split(' + (');

        if (parts.length >= 2) {
            // 1. Mileage Rate: End of first part before " + ("
            const mileagePart = parts[0].split('*');
            if (mileagePart.length > 1) {
                result.mileageRate = parseFloat(mileagePart[mileagePart.length - 1]) || 0;
            }

            // 2. Hourly Rate: End of second part inside parens
            const laborString = parts[1].replace(')', ''); 
            const laborPart = laborString.split('*');
            if (laborPart.length > 1) {
                result.hourlyRate = parseFloat(laborPart[laborPart.length - 1]) || 0;
            }
        }
    } catch (e) {
        console.error("Error parsing string:", calcString, e);
    }
    return result;
}

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
    if (isNaN(d.getTime())) return timeStr.split(' ')[1] || timeStr; 
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function parseMoney(val) {
    if (!val) return { val: 0, text: "$0.00" };
    // Remove $ and commas, parse float
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g,""));
    return { val: (isNaN(num) ? 0 : num), text: val };
}
function formatMoney(num) {
    return "$" + num.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}