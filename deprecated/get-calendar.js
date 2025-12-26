/* get-calendar.js - Fetches Zoho Data */
const ZOHO_OWNER_NAME = "information152";
const ZOHO_APP_LINK = "household-goods-moving-services";
const ZOHO_REPORT_LINK = "Proposal_Contract_Report";
const ZOHO_API_BASE = `https://creator.zoho.com/api/v2/${ZOHO_OWNER_NAME}/${ZOHO_APP_LINK}/report/${ZOHO_REPORT_LINK}`;

async function fetchCalendarEvents() {
    console.log("Fetching Calendar...");
    try {
        const sdk = Descope({ projectId: "P2qXQxJA4H4hvSu2AnDB5VjKnh1d", persistTokens: true });
        const sessionToken = sdk.getSessionToken();
        
        if (!sessionToken) return [];

        const fetchUrl = `${ZOHO_API_BASE}?max_limit=2000`; 
        
        const response = await fetch(fetchUrl, {
            method: "GET",
            headers: {
                "Authorization": `Zoho-oauthtoken ${sessionToken}`,
                "Content-Type": "application/json"
            }
        });

        const data = await response.json();
        return (data.code === 3000) ? data.data : [];

    } catch (error) {
        console.error("Error fetching calendar:", error);
        return [];
    }
}
