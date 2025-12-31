/* ============================================================
   assets/js/timesheets.js
   (Fixed: Sends Email explicitly in Header)
   ============================================================ */

const sdk = Descope({ projectId: 'P2qXQxJA4H4hvSu2AnDB5VjKnh1d', persistTokens: true });
const NETLIFY_PAYOUTS_ENDPOINT = "/.netlify/functions/get-payouts";

document.addEventListener('DOMContentLoaded', async function() {
    const sessionToken = sdk.getSessionToken();
    if (!sessionToken || sdk.isJwtExpired(sessionToken)) {
        window.top.location.href = "/Intranet/login.html";
    } else {
        // We must fetch the full user profile to get the email
        try {
            const userProfile = await sdk.me();
            // Descope puts email in 'email' or 'loginIds[0]'
            const email = userProfile.data.email || userProfile.data.loginIds[0];
            
            if (email) {
                loadTimesheets(sessionToken, email);
            } else {
                throw new Error("Could not find your email address.");
            }
        } catch (err) {
            document.getElementById('error-container').innerHTML = `<div class="error-msg">Auth Error: ${err.message}</div>`;
        }
    }
});

async function loadTimesheets(token, userEmail) {
    const loader = document.getElementById('loading');
    const tableBody = document.getElementById('timesheet-body');
    const noDataMsg = document.getElementById('no-data');
    const errorContainer = document.getElementById('error-container');

    loader.style.display = 'block';
    tableBody.innerHTML = '';
    
    try {
        // 1. Fetch Data
        // We pass the email in a custom header 'X-User-Email'
        const response = await fetch(NETLIFY_PAYOUTS_ENDPOINT, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'X-User-Email': userEmail 
            }
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
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; 
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseMoney(val) {
    if (!val) return { val: 0, text: "$0.00" };
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g,""));
    return { val: (isNaN(num) ? 0 : num), text: val };
}

function formatMoney(num) {
    return "$" + num.toFixed(2);
}