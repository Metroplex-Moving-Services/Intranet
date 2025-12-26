/* =======================================================
   app.js
   Main Controller: Auth, Navigation (setiFrame), and Logic.
   ======================================================= */

const PROJECT_ID = "P2qXQxJA4H4hvSu2AnDB5VjKnh1d";

// 1. Initialize SDK
window.sdk = Descope({ projectId: PROJECT_ID, persistTokens: true, autoRefresh: true });

// Global Variables for your logic
window.userRole = []; // Will hold roles like "Hoobastank", "Phish"

// 2. Startup Function
async function initApp() {
    console.log("App initializing...");
    
    const sessionToken = window.sdk.getSessionToken();
    
    if (sessionToken) {
        try {
            // 1. Fetch User Data
            const user = await window.sdk.me();
            window.user = user; 
            
            // 2. Load Roles (Robust Check)
            window.userRole = (user.data && user.data.roleNames) || user.roleNames || []; 
            console.log("User Roles loaded:", window.userRole);

            // 3. Set Welcome Message
            if (user.data.name) {
                const firstName = user.data.name; 
                $("#welcome-msg").text("Welcome, " + firstName);
                
                // CHANGE: Show the parent block so the Logout button appears too
                $("#user-info-block").show(); 
            }

            // 4. Show the App
            $("#loading").hide();
            $("#app").show();

            // --- THE FIX ---
            // Previously, we checked 'if (!iframe.src)'. That check was failing.
            // Now, we FORCE the Home/Splash page to load every time the app starts.
            console.log("Forcing Home Page Load...");
            
            // We use a tiny delay (100ms) to ensure the iframe is visible 
            // before we try to load the image into it.
            setTimeout(() => {
                setiFrame('empty');
            }, 100);

        } catch (err) {
            console.error("Session invalid:", err);
            handleLogout();
        }
    } else {
        window.location.href = "login.html";
    }
}

// 3. YOUR LOGIC: setiFrame (Refactored)
window.setiFrame = function(purpose) {
    console.log("Navigating to:", purpose);
    
    // Define the Frame
    const MMSiFrame = document.getElementById("contentFrame");
    
    // Show Loading Overlay (Requires gasparesganga-jquery-loading-overlay)
    if ($.LoadingOverlay) {
        $.LoadingOverlay("show", {
            imageColor: "#0C419a",
            imageAnimation: "8000ms pulse"
        });
    }

    // Clear current source
    MMSiFrame.removeAttribute("src");

    // --- NAVIGATION LOGIC ---

    if (purpose == 'newcalendar') {
        MMSiFrame.src = "pages/calendar.html"; 
        hideLoader(1000);
    }
    
    else if (purpose == 'calendar') {
        // External Zoho Link
        MMSiFrame.src = "https://creatorapp.zohopublic.com/information152/household-goods-moving-services/report-embed/Current_Bookings/UVe6stDyTr0Ofd0v8d5YJhGDph0pBaGuBxAAXgnZSMXh6ZgYNTH7aQmQB3UR8G9hxwQ9w9wdeddG74rrA8H7V7TeWWVQtHP9jVzE";
        hideLoader(2000);
    }
    
    else if (purpose == 'addmovertojob') {
        if (checkRole("Hoobastank")) {
            MMSiFrame.src = "https://creatorapp.zohopublic.com/information152/household-goods-moving-services/form-embed/Add_Mover_To_Job/K94Pj9Q02ZQxseasgKf3RRvjqk8A5rC6CREEXtMW14vx3rhJx78x8JFxuke5XTgv1RDEjXm5Qv9AY9bD0rCC6wdAfvhnRTH4GVF4";
            hideLoader(1000);
        } else {
            MMSiFrame.src = "pages/needmoreprivileges.html";
            hideLoader(500);
        }
    }
    
    else if (purpose == 'createinvoice') {
        if (checkRole("Phish")) {
            MMSiFrame.src = "https://creatorapp.zohopublic.com/information152/household-goods-moving-services/form-embed/Create_Stripe_Invoice1/msx9v92BZjs4KNG3QyNAPQSQxY3uOyVaCQMtSOj942pEHzSBhaUmmwvfeDpNPttGEsh3mXGJRvwh55p5Us4hTfbbabw8hZ4ZVG95";
            hideLoader(1000);
        } else {
            MMSiFrame.src = "pages/needmoreprivileges.html";
            hideLoader(500);
        }
    }
    
    else if (purpose == 'myprofile') {
        MMSiFrame.src = "pages/myprofile.html";
        hideLoader(500);
    }

    else if (purpose == 'empty') {
        MMSiFrame.src = "pages/splash.html";
        hideLoader(500);
    }

    else if (purpose == 'jobtimesheets') {
         // This was in your menu but missing from your snippet. Assuming standard page:
         MMSiFrame.src = "pages/jobtimesheets.html";
         hideLoader(500);
    }

    else if (purpose == 'clock-in') {
        if (checkRole("Hoobastank")) {                
            const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
            if (navigator.geolocation) {
                hideLoader(3000);
                // Call the helper function below
                navigator.geolocation.getCurrentPosition(successLocation, errorLocation, options);
            } else {
                alert("Geolocation is not supported by this browser.");
                hideLoader(100);
            }
        } else {
            MMSiFrame.src = "pages/needmoreprivileges.html";
            hideLoader(500);
        }
    }

    // Scroll top
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    
    // Mobile: Close menu
    closeMobileMenu();
};

// 4. Helper Functions
function checkRole(role) {
    // Safety check if userRole isn't loaded yet
    return window.userRole && window.userRole.includes(role);
}

function hideLoader(ms) {
    if ($.LoadingOverlay) {
        setTimeout(function() { $.LoadingOverlay("hide"); }, ms);
    }
}

function closeMobileMenu() {
    if ($(".navbar-toggle").is(":visible") && $(".navbar-collapse").hasClass("in")) {
        $(".navbar-toggle").click();
    }
}

function handleLogout() {
    window.sdk.logout();
    localStorage.removeItem("DSR");
    window.location.href = "login.html";
}

// 5. Geolocation Helpers (You need these for Clock-In to work!)
/* =======================================================
   GEOLOCATION LOGIC (Clock-In)
   ======================================================= */

async function successLocation(position) {
    console.log("Location found. Fetching IP and loading Zoho...");
    
    // 1. Define the iframe (Crucial step!)
    const MMSiFrame = document.getElementById("contentFrame");
    if (!MMSiFrame) return;

    try {
        // 2. Fetch the User's IP Address
        let response = await fetch('https://api.ipify.org/?format=json');
        let data = await response.text(); // or response.json()
        const obj = JSON.parse(data);
        
        // 3. Construct the Zoho URL with IP and Coordinates
        const zohoUrl = "https://creatorapp.zohopublic.com/information152/household-goods-moving-services/form-embed/CheckIn/8O7e3kdZNJF99mA14Gm2EgTfT5DX5YWVfr3jHy451sYFaxAdUDaudFwN86ub4fTN4qxrZHU9Ez1V5Om5zzGwq57Fs0RA9Mv8Db8j";
        
        // Add Query Parameters
        const fullUrl = zohoUrl + 
            "?CapturedIPAddress=" + obj.ip + 
            "&Mover_Coordinates=" + position.coords.latitude + ", " + position.coords.longitude;

        console.log("Loading Clock-In Form...");

        // 4. Load the page
        MMSiFrame.src = fullUrl;
        
        // Hide loader just in case it's still spinning
        hideLoader(1000);

    } catch (err) {
        console.error("Error fetching IP or loading frame:", err);
        alert("Could not load Clock-In. Network error.");
        hideLoader(0);
    }
}

function errorLocation(err) {
    console.warn(`ERROR(${err.code}): ${err.message}`);
    alert("Location access denied. You must allow location to Clock In.");
    hideLoader(0);
}

// Run Startup
document.addEventListener("DOMContentLoaded", initApp);
