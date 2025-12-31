/* ============================================================
   assets/js/timesheets.js
   Description: Fetches and displays user-specific Payout reports
   ============================================================ */

const sdk = Descope({ projectId: 'P2qXQxJA4H4hvSu2AnDB5VjKnh1d', persistTokens: true });

// CHANGE THIS LINE: Use a relative path (starts with /)
// This tells the browser: "Find this function on whatever website I am currently looking at."
const NETLIFY_PAYOUTS_ENDPOINT = "/.netlify/functions/get-payouts";

document.addEventListener('DOMContentLoaded', async function() {
    const sessionToken = sdk.getSessionToken();
    if (!sessionToken || sdk.isJwtExpired(sessionToken)) {
        window.top.location.href = "/Intranet/login.html";
    } else {
        loadTimesheets(sessionToken);
    }
});

async function loadTimesheets(token) {
    const loader = document.getElementById('loading');
    const tableBody = document.getElementById('timesheet-body');
    const noDataMsg = document.getElementById('no-data');
    const errorContainer = document.getElementById('error-container');

    loader.style.display = 'block';
    tableBody.innerHTML = '';
    
    try {
        // 1. Fetch Data
        const response = await fetch(NETLIFY_PAYOUTS_ENDPOINT, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error(await response.text());
        
        const json = await response.json();
        const records = json.data || [];

        // 2. Render Data
        if (records.length === 0) {
            noDataMsg.style.display = 'block';
        } else {
            records.forEach(record => {
                const tr = document.createElement('tr');
                
                // Helpers
                const dateStr = formatDate(record.Job_Date);
                const custName = getZohoVal(record.Customer_Name);
                const duration = record.Job_Duration ? parseFloat(record.Job_Duration).toFixed(2) + " hrs" : "-";
                const tip = parseMoney(record.Tip);
                const extra = parseMoney(record.Extra);
                const payout = parseMoney(record.Payout);
                const payRate = (record.Payout && record.Job_Duration) ? 
                                ((parseFloat(record.Payout.replace(/[^0-9.-]+/g,"")) - tip.val - extra.val) / parseFloat(record.Job_Duration)).toFixed(2) : "0.00";

                tr.innerHTML = `
                    <td data-label="Job Date">${dateStr}</td>
                    <td data-label="Customer">${custName}</td>
                    <td data-label="Duration">${duration}</td>
                    <td data-label="Pay Rate">$${payRate}/hr</td>
                    <td data-label="Tips/Extra">${formatMoney(tip.val + extra.val)}</td>
                    <td data-label="Total Payout" class="money">${formatMoney(payout.val)}</td>
                `;
                tableBody.appendChild(tr);
            });
        }
    } catch (err) {
        console.error("Timesheet Error:", err);
        errorContainer.innerHTML = `<div class="error-msg">Error loading timesheets: ${err.message}</div>`;
    } finally {
        loader.style.display = 'none';
    }
}

// --- Helpers ---
function getZohoVal(field) {
    if (!field) return "";
    if (typeof field === 'object') {
        return `${field.first_name || ""} ${field.last_name || ""}`.trim() || field.display_value || "";
    }
    return field;
}

function formatDate(dateStr) {
    if (!dateStr) return "";
    // ZoHo often returns DD-MMM-YYYY or YYYY-MM-DD
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; 
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseMoney(val) {
    if (!val) return { val: 0, text: "$0.00" };
    // Remove symbols if Zoho sends "$100.00"
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g,""));
    return { val: (isNaN(num) ? 0 : num), text: val };
}

function formatMoney(num) {
    return "$" + num.toFixed(2);
}
