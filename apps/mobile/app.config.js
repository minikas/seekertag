const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || config.android?.googleServicesFile || './google-services.json';
  const file = resolve(__dirname, googleServicesFile);
  if (!existsSync(file)) {
    if (process.env.GOOGLE_SERVICES_JSON || config.android?.googleServicesFile) throw new Error('Firebase: google-services.json was not found at the configured path.');
    return config;
  }
  let firebase;
  try { firebase = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error('Firebase: google-services.json is not valid JSON.'); }
  if (firebase?.private_key || firebase?.type === 'service_account') throw new Error('Firebase: a private service-account key must never be bundled in the Android app. Use google-services.json.');
  const client = firebase?.client?.find(client => client.client_info?.android_client_info?.package_name === config.android?.package);
  const projectId = firebase?.project_info?.project_id;
  if (typeof projectId !== 'string' || !/^\d+$/.test(firebase?.project_info?.project_number || '')
    || !client?.client_info?.mobilesdk_app_id || !client?.api_key?.some(key => typeof key.current_key === 'string' && key.current_key)) {
    throw new Error(`Firebase: download google-services.json for Android package ${config.android?.package}.`);
  }
  return { ...config, android: { ...config.android, googleServicesFile },
    extra: { ...config.extra, firebaseProjectId: projectId } };
};
