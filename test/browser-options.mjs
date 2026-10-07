// Use Playwright's dedicated test browser by default. Never alter managed
// Chrome policies; CHROME_PATH is only for an explicitly permitted browser.
export const browserOptions = {
  headless:true,
  ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})
};
