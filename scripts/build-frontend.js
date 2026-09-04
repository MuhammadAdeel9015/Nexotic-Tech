const fs = require('node:fs/promises');
const path = require('node:path');

async function buildFrontend() {
	const apiBaseUrl = (process.env.VITE_API_URL || '').replace(/\/$/, '');
	const config = `window.APP_CONFIG = { apiBaseUrl: ${JSON.stringify(apiBaseUrl)} };\n`;
	await fs.writeFile(path.resolve(__dirname, '..', 'frontend', 'runtime-config.js'), config);
	console.log(`Frontend runtime config generated${apiBaseUrl ? ' with configured API URL.' : ' for same-origin API use.'}`);
}

buildFrontend().catch(error => {
	console.error(error.message);
	process.exitCode = 1;
});
