import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SESSION_FILE = join(__dirname, "session.json");
const QUEUE_FILE = join(__dirname, "queue.txt");
const ADDED_FILE = join(__dirname, "added.txt");
const ALREADY_EXISTS_FILE = join(__dirname, "already-exists.txt");
const NOT_FOUND_FILE = join(__dirname, "not-found.txt");
const ERRORS_FILE = join(__dirname, "errors.txt");

const BASE_URL = "https://oneschoolglobal.softlinkhosting.com.au";
const SMART_CATALOG_URL = `${BASE_URL}/oliver/cataloguing/smartCataloguing.do`;
const PERMISSION_DENIED_SELECTOR =
  "div.permissionDenied\\?resource\\=%2Fcataloguing%2FsmartCataloguing";
const LOGIN_LINK_SELECTOR = "a.login.topLink[href='login']";

let browser;
let context;
let page;

// Track pages that already have event handlers registered
const pagesWithHandlers = new WeakSet();

function registerPageEventHandlers(targetPage) {
  if (!targetPage) {
    return;
  }

  // Prevent duplicate handler registration
  if (pagesWithHandlers.has(targetPage)) {
    return;
  }

  targetPage.on("dialog", async (dialog) => {
    const message = dialog.message();
    const type = dialog.type();
    console.log(`   → Dialog appeared [${type}]: "${message}" (auto-accept)`);
    try {
      await dialog.accept();
      console.log(`   → Dialog accepted successfully`);
    } catch (error) {
      // Dialog may already be handled by another event listener
      if (!error.message.includes("already handled")) {
        console.log(`   → Failed to accept dialog: ${error.message}`);
      }
    }
  });

  pagesWithHandlers.add(targetPage);
}

// Queue management functions
function readLines(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function writeLines(filePath, lines) {
  writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
}

function appendLine(filePath, line, errorMessage = null) {
  const content = errorMessage ? `${line} # ${errorMessage}` : line;
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  writeFileSync(filePath, existing + content + "\n", "utf-8");
}

function removeFirstLineFromQueue() {
  const queue = readLines(QUEUE_FILE);
  if (queue.length > 0) {
    queue.shift(); // Remove first item
    writeLines(QUEUE_FILE, queue);
  }
}

function getProcessedIsbns() {
  // Read all successfully processed ISBNs (excluding errors.txt for retry)
  const added = readLines(ADDED_FILE);
  const alreadyExists = readLines(ALREADY_EXISTS_FILE);
  const notFound = readLines(NOT_FOUND_FILE);
  return new Set([...added, ...alreadyExists, ...notFound]);
}

function initializeQueue(inputIsbns) {
  const processedIsbns = getProcessedIsbns();
  const existingQueue = readLines(QUEUE_FILE);

  // Clean existing queue of already-processed ISBNs
  const cleanedQueue = existingQueue.filter(
    (isbn) => !processedIsbns.has(isbn)
  );

  if (cleanedQueue.length < existingQueue.length) {
    console.log(
      `Removed ${
        existingQueue.length - cleanedQueue.length
      } already-processed ISBN(s) from queue`
    );
  }

  if (cleanedQueue.length > 0) {
    console.log(`Found existing queue with ${cleanedQueue.length} ISBN(s)`);

    // Filter input ISBNs to only include those not already processed and not in queue
    const newIsbns = inputIsbns.filter(
      (isbn) => !processedIsbns.has(isbn) && !cleanedQueue.includes(isbn)
    );

    if (newIsbns.length > 0) {
      console.log(`Adding ${newIsbns.length} new ISBN(s) to queue`);
      const updatedQueue = [...cleanedQueue, ...newIsbns];
      writeLines(QUEUE_FILE, updatedQueue);
      return updatedQueue;
    } else {
      console.log("No new ISBNs to add to queue");
      if (cleanedQueue.length !== existingQueue.length) {
        writeLines(QUEUE_FILE, cleanedQueue);
      }
      return cleanedQueue;
    }
  } else {
    // No existing queue or it was empty after cleaning
    const newIsbns = inputIsbns.filter((isbn) => !processedIsbns.has(isbn));

    if (newIsbns.length < inputIsbns.length) {
      console.log(
        `Skipped ${
          inputIsbns.length - newIsbns.length
        } already-processed ISBN(s)`
      );
    }

    if (newIsbns.length > 0) {
      console.log(`Creating new queue with ${newIsbns.length} ISBN(s)`);
      writeLines(QUEUE_FILE, newIsbns);
      return newIsbns;
    } else {
      console.log("All ISBNs have already been processed");
      return [];
    }
  }
}

function recordResult(isbn, status, errorMessage = null) {
  switch (status) {
    case "ADDED":
      appendLine(ADDED_FILE, isbn);
      break;
    case "ALREADY_EXISTS":
      appendLine(ALREADY_EXISTS_FILE, isbn);
      break;
    case "NOT_FOUND":
      appendLine(NOT_FOUND_FILE, isbn);
      break;
    case "ERROR":
    case "UNKNOWN":
      appendLine(ERRORS_FILE, isbn, errorMessage || "Unknown error");
      break;
  }
  removeFirstLineFromQueue();
}

async function gotoAndWait(url, options = {}) {
  if (!page) {
    await ensurePage();
  }
  const mergedOptions = { waitUntil: "domcontentloaded", ...options };
  const targetPath = new URL(url).pathname;

  if (process.env.DEBUG) {
    console.log(`   → Navigating to: ${targetPath}`);
  }

  try {
    await page.goto(url, mergedOptions);
  } catch (error) {
    if (error.message?.includes("ERR_ABORTED")) {
      const currentUrl = page.url();
      if (currentUrl.includes(targetPath)) {
        console.log(
          `   → Navigation to ${targetPath} interrupted by redirect; continuing.`
        );
        await page.waitForTimeout(500);
        return;
      }
    }
    throw error;
  }

  await page.waitForTimeout(500);
  if (process.env.DEBUG) {
    console.log(`   → Navigation to ${targetPath} completed`);
  }
}

async function ensurePage() {
  if (!context) {
    throw new Error("Browser context is not initialised");
  }

  if (!page || page.isClosed()) {
    if (page?.isClosed()) {
      console.log("   → Current browser tab was closed, opening a new one...");
    } else {
      console.log("   → Opening browser tab...");
    }

    page = await context.newPage();
    registerPageEventHandlers(page);
  }

  return page;
}

async function loginThroughPopup() {
  await ensurePage();

  let loginLink = page.locator(LOGIN_LINK_SELECTOR);
  let loginVisible = await loginLink.isVisible().catch(() => false);

  if (!loginVisible) {
    console.log("   → Login link not visible, navigating to home page...");
    await gotoAndWait(`${BASE_URL}/oliver/home/browse/list`);
    loginLink = page.locator(LOGIN_LINK_SELECTOR);
    loginVisible = await loginLink.isVisible().catch(() => false);
  }

  if (!loginVisible) {
    console.log("   → Login link still unavailable after navigating home.");
    return false;
  }

  const maxLoginDialogAttempts = 3;
  let submittedCredentials = false;

  for (let attempt = 1; attempt <= maxLoginDialogAttempts; attempt++) {
    if (attempt > 1) {
      console.log(
        `   → Login dialog retry (${attempt}/${maxLoginDialogAttempts})...`
      );
    }

    console.log("   → Opening login dialog...");
    await loginLink.first().click();

    const loginFormReady = await page
      .waitForSelector("#loginForm_username", { timeout: 8000 })
      .catch(() => null);

    if (!loginFormReady) {
      console.log("   → Login form did not appear, closing dialog...");
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
      loginLink = page.locator(LOGIN_LINK_SELECTOR);
      const stillVisible = await loginLink.isVisible().catch(() => false);
      if (!stillVisible) {
        await gotoAndWait(`${BASE_URL}/oliver/home/browse/list`);
        loginLink = page.locator(LOGIN_LINK_SELECTOR);
      }
      continue;
    }

    await page.fill("#loginForm_username", process.env.OLIVER_USERNAME);
    await page.fill("#loginForm_password", process.env.OLIVER_PASSWORD);
    console.log("   → Submitting login credentials...");
    await page.click('#dialogContent button[type="submit"]');
    submittedCredentials = true;
    break;
  }

  if (!submittedCredentials) {
    console.log("   → Failed to submit credentials; login aborted.");
    return false;
  }

  console.log("   → Waiting for page to settle after login...");
  try {
    await page.waitForLoadState("load", { timeout: 10000 });
    console.log("   → Page loaded.");
  } catch (error) {
    console.log(`   → Page load timeout: ${error.message}`);
  }

  await page.waitForTimeout(500);
  console.log("   → Checking login status...");

  const logoutVisible = await page
    .waitForSelector("#window_logout", { timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (!logoutVisible) {
    console.log("   → Login dialog completed but logout control missing.");
    return false;
  }

  console.log("   → Login confirmed; saving session.");
  await context.storageState({ path: SESSION_FILE });
  console.log("   → Session saved, login complete.");
  return true;
}

async function attemptDirectSmartCatalog(maxAttempts = 5) {
  await ensurePage();

  console.log("   → Ensuring Smart Cataloguing access (direct)...");

  let attemptedLogin = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      console.log(
        `   → Direct Smart Cataloguing retry (${attempt}/${maxAttempts})...`
      );
    }

    await gotoAndWait(SMART_CATALOG_URL);

    const currentUrl = page.url();
    const loginVisible = await page
      .isVisible(LOGIN_LINK_SELECTOR)
      .catch(() => false);
    const permissionDenied =
      (await page.isVisible(PERMISSION_DENIED_SELECTOR).catch(() => false)) ||
      currentUrl.includes("permissionDenied");

    if (loginVisible) {
      if (attemptedLogin) {
        console.log(
          "   → Direct navigation still shows login after re-auth; switching to menu."
        );
        break;
      }

      console.log("   → Session not active on direct load, invoking login...");
      const loginSuccess = await loginThroughPopup();
      if (!loginSuccess) {
        console.log("   → Login attempt unsuccessful.");
        await page.waitForTimeout(1000);
        continue;
      }
      attemptedLogin = true;
      continue;
    }

    if (!permissionDenied) {
      if (!currentUrl.includes("/oliver/cataloguing/smartCataloguing.do")) {
        console.log(
          `   → Direct navigation redirected to ${currentUrl}, switching to menu fallback.`
        );
        break;
      }

      try {
        await page.waitForSelector("#smartCatSearchTerm", { timeout: 15000 });
        return true;
      } catch (_) {
        console.log("   → Smart Cataloguing page not ready, retrying...");
        continue;
      }
    }

    console.log("   → Smart Cataloguing access denied; attempting login...");
    if (attemptedLogin) {
      console.log(
        "   → Direct access still denied after login; switching to menu fallback."
      );
      break;
    }

    const loginSuccess = await loginThroughPopup();
    if (!loginSuccess) {
      console.log("   → Login attempt unsuccessful.");
      await page.waitForTimeout(1000);
      continue;
    }

    attemptedLogin = true;
  }

  return false;
}

async function attemptMenuSmartCatalog(attempt = 1) {
  if (attempt > 3) {
    return false;
  }

  if (attempt > 1) {
    console.log(
      `   → Menu navigation retry (${attempt}/3) to reach Smart Cataloguing...`
    );
  } else {
    console.log("   → Direct navigation failed; trying menu navigation...");
  }

  await gotoAndWait(`${BASE_URL}/oliver/welcome.do`);

  const logoutVisible = await page
    .isVisible("#window_logout")
    .catch(() => false);

  if (!logoutVisible) {
    console.log("   → Logged out on welcome page, attempting login...");
    const loginSuccess = await loginThroughPopup();
    if (!loginSuccess) {
      console.log("   → Login attempt unsuccessful.");
      return attemptMenuSmartCatalog(attempt + 1);
    }
    // Check if we're already on welcome page after login
    const currentUrl = page.url();
    if (!currentUrl.includes("/oliver/welcome.do")) {
      console.log("   → Login successful, navigating to welcome page...");
      await gotoAndWait(`${BASE_URL}/oliver/welcome.do`);
    } else {
      console.log("   → Login successful, already on welcome page.");
    }
    console.log("   → Waiting for page to fully initialize...");
    await page.waitForTimeout(1000); // Give page time to fully load and initialize menus
  }

  console.log("   → Checking for cataloguing menu...");
  try {
    await page.waitForSelector("#menu_cataloguing", {
      timeout: 20000,
    });
    console.log("   → Cataloguing menu found!");
  } catch (_) {
    console.log(
      "   → Cataloguing menu not visible, refreshing welcome page..."
    );
    await page.reload({ waitUntil: "domcontentloaded" }).catch(async () => {
      await gotoAndWait(`${BASE_URL}/oliver/welcome.do`);
    });

    // Try again after refresh, retry the whole function if still not visible
    try {
      await page.waitForSelector("#menu_cataloguing", {
        timeout: 20000,
      });
    } catch (_) {
      console.log(
        "   → Cataloguing menu still not visible after refresh, retrying..."
      );
      return attemptMenuSmartCatalog(attempt + 1);
    }
  }

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);

  const popupPromise = context
    .waitForEvent("page", { timeout: 4000 })
    .catch(() => null);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log("   → Clicking Cataloguing menu to open dropdown...");
      await page.locator("#menu_cataloguing").click({ timeout: 5000 });
      console.log("   → Cataloguing menu clicked successfully");
      break;
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      console.log(
        `   → Cataloguing header click blocked (attempt ${attempt}), retrying after clearing overlays...`
      );
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  console.log("   → Waiting for Smart Cataloguing menu item to appear...");
  await page.waitForTimeout(1500);

  // There are often 2 elements with this ID - one hidden, one visible
  // We need to click the visible one (usually the last one)
  const menuItems = await page.locator("#menuItem_smartCataloguing").all();
  console.log(`   → Found ${menuItems.length} Smart Cataloguing menu items`);

  let visibleItem = null;
  for (const item of menuItems) {
    const isVisible = await item.isVisible();
    if (isVisible) {
      visibleItem = item;
      console.log("   → Found visible Smart Cataloguing menu item");
      break;
    }
  }

  if (!visibleItem) {
    throw new Error("No visible Smart Cataloguing menu item found");
  }

  console.log("   → Clicking visible Smart Cataloguing menu item...");
  await visibleItem.click();

  const popup = await popupPromise;
  if (popup) {
    page = popup;
    registerPageEventHandlers(page);
  } else {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    } catch (_) {
      // Ignore load-state timeouts spawned by background requests.
    }
  }

  const loginVisible = await page
    .isVisible(LOGIN_LINK_SELECTOR)
    .catch(() => false);
  if (loginVisible) {
    console.log(
      "   → Menu navigation landed on login page, re-authenticating..."
    );
    const loginSuccess = await loginThroughPopup();
    if (!loginSuccess) {
      console.log("   → Login dialog failed during menu fallback.");
      return attemptMenuSmartCatalog(attempt + 1);
    }
    // After login, retry menu navigation instead of direct
    return attemptMenuSmartCatalog(attempt + 1);
  }

  const permissionDenied = await page
    .isVisible(PERMISSION_DENIED_SELECTOR)
    .catch(() => false);
  if (permissionDenied) {
    console.log("   → Menu navigation returned permission denied, retrying...");
    await page.waitForTimeout(500);
    return attemptMenuSmartCatalog(attempt + 1);
  }

  try {
    await page.waitForSelector("#smartCatSearchTerm", { timeout: 15000 });
    return true;
  } catch (_) {
    console.log(
      "   → Smart Cataloguing page incomplete after menu navigation."
    );
    await page.waitForTimeout(1000);
    return attemptMenuSmartCatalog(attempt + 1);
  }
}

async function ensureSmartCataloguingPage() {
  // Skip direct navigation - it never works after login, always use menu method
  return attemptMenuSmartCatalog();
}

async function navigateToSmartCataloguing() {
  return ensureSmartCataloguingPage();
}

async function searchSmartCataloguing(isbn, attempt = 1) {
  if (attempt > 3) {
    return false;
  }

  try {
    console.log("   → Waiting for search field to be available...");
    await page.waitForSelector("#smartCatSearchTerm", { timeout: 15000 });
  } catch {
    console.log("   → Search field unavailable, reloading page...");
    const reNav = await navigateToSmartCataloguing();
    if (!reNav) {
      return false;
    }
    return searchSmartCataloguing(isbn, attempt + 1);
  }

  await page.fill("#smartCatSearchTerm", "");
  await page.fill("#smartCatSearchTerm", isbn);
  await page.click("#smartCatSearchButton");

  // Check for and dismiss the modal dialog that may appear on subsequent searches
  try {
    const modalDialog = await page.waitForSelector("[id^='modalPopupId_']", {
      timeout: 1000,
    });
    if (modalDialog) {
      console.log("   → Modal dialog appeared, dismissing...");
      const okButton = await page.$("#dialogButton_OK");
      if (okButton) {
        await okButton.click();
        console.log("   → Modal dismissed");
        await page.waitForTimeout(300);
      }
    }
  } catch (_) {
    // No modal appeared, continue
  }

  // Wait for the search to start - the message should change to "Search, please wait..."
  try {
    console.log("   → Waiting for search to start...");
    await page.waitForFunction(
      () => {
        const msgElement =
          document.querySelector("#smartCatFoundMsg") ||
          document.querySelector(".smartCatFoundMsg");
        if (!msgElement) return false;
        const text = msgElement.innerText.trim();
        return text && !text.includes("Search, please wait...");
      },
      { timeout: 2000 }
    );
  } catch (_) {
    // Continue if loading message doesn't appear
  }

  // Now wait for the search to complete - the status message changes to the actual result
  try {
    await page.waitForFunction(
      () => {
        const msgElement =
          document.querySelector("#smartCatFoundMsg") ||
          document.querySelector(".smartCatFoundMsg");
        if (!msgElement) return false;
        const text = msgElement.innerText.trim();
        // Wait until it's NOT the loading message anymore
        return text && !text.includes("Search, please wait...");
      },
      { timeout: 10000 }
    );
  } catch (_) {
    // If the status message doesn't change, allow a short grace period
    await page.waitForTimeout(1500);
  }

  const loginVisible = await page
    .isVisible(LOGIN_LINK_SELECTOR)
    .catch(() => false);

  const stillOnSmartCataloguing = page
    .url()
    .includes("/oliver/cataloguing/smartCataloguing.do");

  const permissionDenied = await page
    .isVisible(PERMISSION_DENIED_SELECTOR)
    .catch(() => false);

  if (
    (loginVisible || !stillOnSmartCataloguing || permissionDenied) &&
    attempt < 3
  ) {
    console.log("   → Search broke session, re-authenticating...");
    const reNav = await navigateToSmartCataloguing();
    if (!reNav) {
      return false;
    }
    return searchSmartCataloguing(isbn, attempt + 1);
  }

  return stillOnSmartCataloguing;
}

async function processISBN(isbn, skipNavigation = false) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Processing ISBN: ${isbn}`);
  console.log("=".repeat(50));

  try {
    // Only navigate if it's the first ISBN or if explicitly requested
    if (!skipNavigation) {
      const navSuccess = await navigateToSmartCataloguing();
      if (!navSuccess) {
        console.log("❌ Failed to navigate to Smart Cataloguing page");
        const result = { isbn, status: "ERROR", error: "Navigation failed" };
        recordResult(isbn, result.status, result.error);
        return result;
      }
    }

    const searchReady = await searchSmartCataloguing(isbn);
    if (!searchReady) {
      console.log(
        "❌ Unable to complete search after session refresh attempts"
      );
      const result = {
        isbn,
        status: "ERROR",
        error: "Search failed after re-login",
      };
      recordResult(isbn, result.status, result.error);
      return result;
    }

    const statusMessageHandle =
      (await page.$("#smartCatFoundMsg")) ||
      (await page.$(".smartCatFoundMsg"));

    const statusText = statusMessageHandle
      ? (await statusMessageHandle.innerText()).trim()
      : "";

    if (statusText.toLowerCase().includes("no matching resource")) {
      console.log("❌ ISBN not found - no matching resource");
      const result = { isbn, status: "NOT_FOUND" };
      recordResult(isbn, result.status);
      return result;
    }

    if (statusText.toLowerCase().includes("found matching resource")) {
      const saveButton = await page.$("#smartCatSaveResource");
      if (saveButton) {
        const isDisabled = await saveButton.isDisabled();
        if (isDisabled) {
          console.log("⏭️  Resource already exists in catalog");
          const result = { isbn, status: "ALREADY_EXISTS" };
          recordResult(isbn, result.status);
          return result;
        }

        console.log("✅ Resource found and not yet catalogued, saving...");
        await saveButton.click();

        // Check for and dismiss the modal dialog that may appear after saving
        try {
          const modalDialog = await page.waitForSelector("[id^='modalPopupId_']", {
            timeout: 2000,
          });
          if (modalDialog) {
            console.log("   → Save confirmation modal appeared, dismissing...");
            const okButton = await page.$("#dialogButton_OK");
            if (okButton) {
              await okButton.click();
              console.log("   → Modal dismissed");
              await page.waitForTimeout(500);
            }
          }
        } catch (_) {
          // No modal appeared, continue
        }

        try {
          await page.waitForLoadState("load", { timeout: 8000 });
        } catch (_) {
          // Ignore load-state timeouts; data saves even if background polling continues.
        }

        console.log("✅ Resource saved successfully!");
        const result = { isbn, status: "ADDED" };
        recordResult(isbn, result.status);
        return result;
      }

      console.log("⚠️  Found resource but save control missing");
      const result = { isbn, status: "UNKNOWN" };
      recordResult(isbn, result.status, "Save button not found");
      return result;
    }

    console.log("⚠️  Warning: No status message after search:", statusText);
    const result = { isbn, status: "UNKNOWN" };
    recordResult(isbn, result.status, "No status message");
    return result;
  } catch (error) {
    console.error(`❌ Error processing ISBN ${isbn}: ${error.message}`);
    if (page?.isClosed?.()) {
      console.log(
        "   → Page closed unexpectedly; it will be recreated on the next iteration."
      );
    }
    const result = { isbn, status: "ERROR", error: error.message };
    recordResult(isbn, result.status, result.error);
    return result;
  }
}

async function runOliverAutomation(isbns) {
  console.log("Starting Oliver Library automation...");

  if (!process.env.OLIVER_USERNAME || !process.env.OLIVER_PASSWORD) {
    console.error(
      "Error: Please create a .env file with OLIVER_USERNAME and OLIVER_PASSWORD"
    );
    console.error("See .env.example for reference");
    process.exit(1);
  }

  if (!isbns || isbns.length === 0) {
    console.error("Error: No ISBNs provided");
    console.error("Usage: node index.js <ISBN or file path>");
    process.exit(1);
  }

  // Initialize queue with input ISBNs
  const queue = initializeQueue(isbns);
  console.log(`\nTotal ISBNs in queue: ${queue.length}`);

  // Skip processing if queue is empty
  if (queue.length === 0) {
    console.log("\n✅ No ISBNs to process. Exiting.");
    return;
  }

  const headless =
    process.env.HEADLESS === "true" || process.env.HEADLESS === "1";
  if (headless) {
    console.log("Running in headless mode (browser will not be visible)");
  } else {
    console.log(
      "Running with visible browser (use HEADLESS=true to run headlessly)"
    );
  }

  browser = await chromium.launch({
    headless: headless,
    slowMo: headless ? 0 : 100, // No slowMo in headless mode for better performance
  });

  const hasSession = existsSync(SESSION_FILE);

  if (hasSession) {
    console.log("Found saved session, loading...");
    context = await browser.newContext({ storageState: SESSION_FILE });
  } else {
    console.log("No saved session found");
    context = await browser.newContext();
  }

  context.on("page", (newPage) => {
    registerPageEventHandlers(newPage);
  });

  page = await context.newPage();
  registerPageEventHandlers(page);

  try {
    console.log("Preparing Smart Cataloguing session...");
    const initialReady = await navigateToSmartCataloguing();
    if (!initialReady) {
      console.log("❌ Unable to reach Smart Cataloguing interface");
      return;
    }

    const results = [];
    const totalToProcess = queue.length;
    let processed = 0;

    // Process ISBNs from queue (queue will be updated as we go)
    while (true) {
      const currentQueue = readLines(QUEUE_FILE);
      if (currentQueue.length === 0) {
        break; // Queue is empty
      }

      const isbn = currentQueue[0]; // Always process the first item
      processed++;

      const remaining = currentQueue.length - 1;
      console.log(
        `\nProgress: ${processed}/${totalToProcess} (${remaining} remaining in queue)`
      );

      // Skip navigation since we're already on Smart Cataloguing page
      const result = await processISBN(isbn, true);
      results.push(result);
    }

    console.log("\n" + "=".repeat(70));
    console.log("PROCESSING COMPLETE - REPORT");
    console.log("\n" + "=".repeat(70));

    // Read results from files
    const added = readLines(ADDED_FILE);
    const alreadyExists = readLines(ALREADY_EXISTS_FILE);
    const notFound = readLines(NOT_FOUND_FILE);
    const errorLines = existsSync(ERRORS_FILE)
      ? readFileSync(ERRORS_FILE, "utf-8")
          .split(/\r?\n/)
          .filter((l) => l.trim())
      : [];

    console.log(`\n✅ ADDED (${added.length}):`);
    if (added.length > 0) {
      added.forEach((isbn) => {
        console.log(`   - ${isbn}`);
      });
    } else {
      console.log("   None");
    }

    console.log(`\n⏭️  ALREADY EXISTS (${alreadyExists.length}):`);
    if (alreadyExists.length > 0) {
      alreadyExists.forEach((isbn) => {
        console.log(`   - ${isbn}`);
      });
    } else {
      console.log("   None");
    }

    console.log(`\n❌ NOT FOUND (${notFound.length}):`);
    if (notFound.length > 0) {
      notFound.forEach((isbn) => {
        console.log(`   - ${isbn}`);
      });
    } else {
      console.log("   None");
    }

    if (errorLines.length > 0) {
      console.log(`\n❌ ERRORS (${errorLines.length}):`);
      errorLines.forEach((line) => {
        console.log(`   - ${line}`);
      });
    }

    const totalProcessed =
      added.length + alreadyExists.length + notFound.length + errorLines.length;

    console.log("\n" + "=".repeat(70));
    console.log(
      `Total: ${totalProcessed} | Added: ${added.length} | Already Exists: ${alreadyExists.length} | Not Found: ${notFound.length}`
    );
    // console.log("=".repeat(70));

    const reportPath = join(__dirname, "report.txt");
    const reportContent = `Oliver Library Upload Report
Generated: ${new Date().toLocaleString()}

SUMMARY:
- Total ISBNs Processed: ${totalProcessed}
- Added: ${added.length}
- Already Exists: ${alreadyExists.length}
- Not Found: ${notFound.length}
- Errors: ${errorLines.length}

ADDED (${added.length}):
${added.join("\n") || "None"}

ALREADY EXISTS (${alreadyExists.length}):
${alreadyExists.join("\n") || "None"}

NOT FOUND (${notFound.length}):
${notFound.join("\n") || "None"}

${
  errorLines.length > 0
    ? `ERRORS (${errorLines.length}):\n${errorLines.join("\n")}`
    : ""
}
`;

    writeFileSync(reportPath, reportContent);
    console.log(`\n📄 Report saved to: ${reportPath}`);
    console.log("\nResult files:");
    console.log(`  - Queue: ${QUEUE_FILE}`);
    console.log(`  - Added: ${ADDED_FILE}`);
    console.log(`  - Already Exists: ${ALREADY_EXISTS_FILE}`);
    console.log(`  - Not Found: ${NOT_FOUND_FILE}`);
    console.log(`  - Errors: ${ERRORS_FILE}`);
    if (browser) {
      await browser.close();
    }
  } catch (error) {
    console.error("Error during automation:", error.message);
    console.error("Stack trace:", error.stack);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
}

const input = process.argv[2];

if (!input) {
  console.error("Error: Please provide an ISBN or file path");
  console.error("Usage:");
  console.error("  Single ISBN:  node index.js 9780545139700");
  console.error("  File:         node index.js isbns.txt");
  console.error("  File:         node index.js isbns.csv");
  process.exit(1);
}

let isbns = [];

if (existsSync(input)) {
  console.log(`Reading ISBNs from file: ${input}`);
  const content = readFileSync(input, "utf-8");

  isbns = content
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  console.log(`Found ${isbns.length} ISBNs in file`);
} else {
  isbns = [input];
}

runOliverAutomation(isbns);
