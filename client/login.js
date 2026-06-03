const loginForm = document.getElementById("loginForm");
const loginTitle = document.getElementById("loginTitle");
const loginSubtitle = document.getElementById("loginSubtitle");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginSubmit = document.getElementById("loginSubmit");
const loginStatus = document.getElementById("loginStatus");
const passwordHint = document.getElementById("passwordHint");

const params = new URLSearchParams(window.location.search);
const nextPath = params.get("next") || "/manage.html";
let setupMode = false;

function setStatus(message, isError = false) {
  loginStatus.textContent = message;
  loginStatus.classList.toggle("is-error", isError);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function applyMode(hasAccounts) {
  setupMode = !hasAccounts;
  loginTitle.textContent = setupMode ? "Create Admin Account" : "Manage Login";
  loginSubtitle.textContent = setupMode
    ? "Create the first account for this local app."
    : "Sign in to manage folders and uploads.";
  loginSubmit.textContent = setupMode ? "Create account" : "Sign in";
  loginPassword.autocomplete = setupMode ? "new-password" : "current-password";
  passwordHint.classList.toggle("hidden", !setupMode);
}

function validateSetupPassword(username, password) {
  const value = String(password || "");
  const normalized = value.toLowerCase();
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const commonPasswords = new Set([
    "password",
    "password1",
    "password12",
    "password123",
    "qwerty",
    "qwerty123",
    "admin",
    "admin123",
    "letmein",
    "welcome",
    "welcome123",
    "12345678",
    "123456789",
    "1234567890",
    "11111111",
    "00000000"
  ]);

  if (value.length < 10) {
    throw new Error("Password must be at least 10 characters.");
  }

  if (/^\d+$/.test(value)) {
    throw new Error("Password cannot contain only numbers.");
  }

  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value)) {
    throw new Error("Password must include uppercase and lowercase letters.");
  }

  if (!/\d/.test(value)) {
    throw new Error("Password must include at least one number.");
  }

  if (!/[^A-Za-z0-9]/.test(value)) {
    throw new Error("Password must include at least one special symbol.");
  }

  if (commonPasswords.has(normalized)) {
    throw new Error("Password is too common.");
  }

  if (normalizedUsername && normalized.includes(normalizedUsername)) {
    throw new Error("Password cannot contain the username.");
  }
}

async function loadStatus() {
  try {
    const status = await api("/api/auth/status");

    if (status.authenticated) {
      window.location.href = nextPath;
      return;
    }

    applyMode(status.hasAccounts);
  } catch (err) {
    setStatus(err.message || "Failed to load login status.", true);
  }
}

loginForm.onsubmit = async (event) => {
  event.preventDefault();
  loginSubmit.disabled = true;
  setStatus(setupMode ? "Creating account..." : "Signing in...");

  try {
    if (setupMode) {
      validateSetupPassword(loginUsername.value, loginPassword.value);
    }

    await api(setupMode ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: loginUsername.value.trim(),
        password: loginPassword.value
      })
    });

    window.location.href = nextPath;
  } catch (err) {
    setStatus(err.message || "Login failed.", true);
    loginSubmit.disabled = false;
  }
};

loadStatus();
