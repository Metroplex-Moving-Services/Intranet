/* ============================================================
   netlify/functions/clock-in.js
   [DIAGNOSTIC MODE] 
   This script fetches the field metadata to reveal the required Date Format.
   ============================================================ */

const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN; 
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

const APP_OWNER = "information152";
const APP_LINK = "household-goods-moving-services";
const FORM_NAME = "CheckIn"; 

// --- HELPER: GET TOKEN ---
async function getAccessToken() {
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${ZOHO_REFRESH_TOKEN}&client_id=${ZOHO_CLIENT_ID}&client_secret=${ZOHO_CLIENT_SECRET}&grant_type=refresh_token`;
    const res = await fetch(tokenUrl, { method: 'POST' });
    const data = await res.json();
    return data.access_token;
}

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    try {
        const accessToken = await getAccessToken();
        
        // --- THE DIAGNOSTIC CALL ---
        // We ask Zoho for the list of fields in the CheckIn form
        const fieldsUrl = `https://creator.zoho.com/api/v2/${APP_OWNER}/${APP_LINK}/form/${FORM_NAME}/fields`;
        
        const response = await fetch(fieldsUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
        });
        
        const data = await response.json();

        // Find the specific field causing the error
        const targetField = data.fields 
            ? data.fields.find(f => f.link_name === "Actual_Clock_in_Time1") 
            : null;

        return {
            statusCode: 400, // Keep as 400 so it shows up in your console error log
            headers,
            body: JSON.stringify({
                diagnostic_mode: "ON",
                message: "Here is the field definition from Zoho.",
                all_fields_found: data.code === 3000,
                // Return the specific field info so we can see the 'dateFormat'
                field_definition: targetField || "Field not found in response",
                // Return the raw response just in case
                raw_response: data 
            })
        };

    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};