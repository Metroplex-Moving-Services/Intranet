/* =======================================================
   profile.js
   Handles populating the user data on the My Profile page
   by reading from the parent window's session.
   ======================================================= */

$(document).ready(function() {
    console.log("Profile Page Loaded. Attempting to get user data...");

    try {
        // 1. Access the 'user' variable from app.js (parent window)
        // We use 'window.parent' because this page lives inside an iframe
        var parentUser = window.parent.user;
        
        console.log("User Data Received from Parent:", parentUser);

        if (parentUser && parentUser.data) {
            var userData = parentUser.data;
            
            // 2. POPULATE TEXT FIELDS
            // We use '||' to provide a fallback if the data is missing
            $("#dispName").text(userData.name || "Team Member");
            $("#dispEmail").text(userData.email || "No Email on File");
            $("#dispPhone").text(userData.phone || "No Phone on File");
            $("#dispId").text(userData.userId || "Unknown ID");

            // 3. HANDLE ROLES 
            // Note: roleNames is usually outside the 'data' object
            var roles = parentUser.roleNames || userData.roleNames || [];
            $("#dispRole").text(roles.length > 0 ? roles.join(", ") : "Standard User");

            // 4. PROFILE PICTURE LOGIC
            if (userData.picture) {
                // Replace the default icon with the actual image
                $("#avatarContainer").html(
                    `<img src="${userData.picture}" alt="Profile" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`
                );
                // Make the background transparent
                $("#avatarContainer").css("background-color", "transparent");
            } 
            
        } else {
            console.error("User object is missing or empty.");
            $("#dispName").text("Session Error");
            $(".detail-value").text("Data unavailable. Please re-login.");
        }

    } catch (e) {
        console.error("CRITICAL ERROR in profile.js:", e);
        $("#dispName").text("System Error");
    }
});
