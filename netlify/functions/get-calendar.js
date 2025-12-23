const fetch = require('node-fetch');

// --- ROBUST IMPORT LOGIC ---
const descopePkg = require('@descope/node-sdk');
// Try to grab the client from standard locations:
const DescopeClient = descopePkg.default || descopePkg.DescopeClient || descopePkg;

exports.handler = async function(event, context) {
  
  // 1. DEFINE HEADERS FIRST (So they are available for EVERY return statement)
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // 2. PRE-FLIGHT CHECK
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: headers, body: "" };
  }

  try {
    console.log("Function started. Method:", event.httpMethod);

    // --- SECURITY GATEWAY START ---
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    if (!authHeader) {
      console.warn("Security Block: No Authorization header provided.");
      return { statusCode: 401, headers: headers, body: JSON.stringify({ error: "Unauthorized: Missing Token" }) };
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");

    // INITIALIZATION FIX (Wrapped in Try/Catch to prevent crashes)
    let descopeClient;
    try {
        if (typeof DescopeClient === 'function') {
             try {
                 descopeClient = DescopeClient({ projectId: process.env.DESCOPE_PROJECT_ID });
             } catch (e) {
                 descopeClient = new DescopeClient({ projectId: process.env.DESCOPE_PROJECT_ID });
             }
        } else {
             throw new Error("Descope Library failed to load. Import type was: " + typeof DescopeClient);
        }
    } catch (initErr) {
        console.error("Descope Init Error:", initErr);
        // RETURN 500 WITH HEADERS so you see the real error, not CORS error
        return { statusCode: 500, headers: headers, body: JSON.stringify({ error: "Security Library Error", details: initErr.message }) };
    }

    // Validate Token
    try {
      await descopeClient.validateSession(token);
    } catch (authError) {
      console.error("Security Block: Invalid Token", authError.message);
      return { statusCode: 403, headers: headers, body: JSON.stringify({ error: "Forbidden: Invalid or Expired Token" }) };
    }
    // --- SECURITY GATEWAY END ---


    // 3. ZOHO CONFIGURATION
    const REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
    const CLIENT_ID = process.env.ZOHO_CLIENT_ID;
    const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
    
    const OWNER_NAME = "information152"; 
    const APP_LINK_NAME = "household-goods-moving-services";
    // Ensure this matches your specific report name
    const REPORT_LINK_NAME = "Current_Bookings"; 

    // 4. GET ACCESS TOKEN
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${REFRESH_TOKEN}&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=refresh_token`;
    
    const tokenResponse = await fetch(tokenUrl, { method: 'POST' });
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      console.error("Zoho Token Error:", tokenData.error);
      return { statusCode: 500, headers: headers, body: JSON.stringify({ error: "Backend Connection Error - Token Failed" }) };
    }
    
    const accessToken = tokenData.access_token;

    // 5. FETCH DATA
    const zohoDataUrl = `https://creator.zoho.com/api/v2/${OWNER_NAME}/${APP_LINK_NAME}/report/${REPORT_LINK_NAME}`;
    
    const dataResponse = await fetch(zohoDataUrl, {
      method: 'GET',
      headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
    });
    
    const zohoJson = await dataResponse.json();

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        data: zohoJson.data || [],
        message: "Success"
      })
    };

  } catch (error) {
    console.error("Critical Function Error:", error);
    // RETURN 500 WITH HEADERS so you see the real error
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: "Internal Server Error", details: error.message })
    };
  }
};
