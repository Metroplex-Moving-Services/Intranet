/* ======================================================= 
   app.js
   The Main Controller for the Intranet.
   Handles: Auth, User Session, Navigation (DoIt), and Logout.
   ======================================================= */

const PROJECT_ID = "P2qXQxJA4H4hvSu2AnDB5VjKnh1d";

// 1. Initialize Descope SDK Globally
// We attach it to 'window' so child iframes can access it if needed
window.sdk = Descope({ projectId: PROJECT_ID, persistTokens: true, autoRefresh: true });

// 2. Main Startup Function (Runs on Page Load)
async function initApp() {
    console.log("App initializing...");
    
    // Check if we have a session
    const sessionToken = window.sdk.getSessionToken();
    
    if (sessionToken) {
        try {
            // Valid Token -> Fetch User Details
            const user = await window.sdk.me();
            window.user = user; // Store globally
            
            console.log("User authenticated:", user.data.name);

            // UI: Hide Loading, Show App
            const loadScreen = document.getElementById("loading");
            const appScreen = document.getElementById("app");
            if(loadScreen) loadScreen.style.display = "none";
            if(appScreen) appScreen.style.display = "block";

            // If the iframe is empty, load the Splash (Home) page
            // This effectively runs "DoIt()" on startup
            const iframe = document.getElementById("contentFrame");
            if (iframe && !iframe.src) {
                DoIt(); 
            }

        } catch (err) {
            console.error("Session invalid:", err);
            handleLogout(); // Invalid token? Kick them out.
        }
    } else {
        console.warn("No session token found.");
        window.location.href = "login.html"; // Redirect to login
    }
}

// 3. Navigation Helper (setIframe)
// Usage: onclick="setIframe('pages/calendar.html')"
window.setIframe = function(url) {
    const iframe = document.getElementById("contentFrame");
    if (iframe) {
        iframe.src = url;
        
        // Mobile UX: Auto-close the menu after clicking a link
        const navbarCollapse = document.querySelector(".navbar-collapse");
        // If we are on mobile (toggle exists and is visible)
        if ($(".navbar-toggle").is(":visible") && $(".navbar-collapse").hasClass("in")) {
            $(".navbar-toggle").click(); // Simulate click to close
        }
    }
};

// 4. "DoIt" - The Homepage Reset Function
// Loads the greeting, navigation, and company picture (Splash Page)
window.DoIt = function() {
    console.log("Resetting to Home/Splash...");
    setIframe('pages/splash.html');
};

// 5. Logout Logic
window.handleLogout = async function() {
    try {
        await window.sdk.logout();
    } catch (err) {
        console.error("Logout error", err);
    }
    localStorage.removeItem("DSR"); // Clear local keys
    window.location.href = "login.html";
};

// Run Startup when DOM is ready
document.addEventListener("DOMContentLoaded", initApp);
