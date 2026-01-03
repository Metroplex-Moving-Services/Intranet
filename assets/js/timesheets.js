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

        // Accumulate Totals
        const duration = parseFloat(job.Job_Duration) || 0; 
        const p = parseMoney(job.Payout).val;
        const totalPay = p; 

        groups[weekKey].totalHours += duration;
        groups[weekKey].totalPayout += totalPay;
    });

    const sortedWeeks = Object.values(groups).sort((a, b) => b.startDate - a.startDate);
    sortedWeeks.forEach(week => {
        week.jobs.sort((a, b) => new Date(b.Job_Date)