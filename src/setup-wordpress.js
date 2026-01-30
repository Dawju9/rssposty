import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const questions = [
  {
    type: 'input',
    name: 'wpUrl',
    message: 'WordPress URL (e.g., https://example.com/wp-json/wp/v2/posts):',
    validate: (input) => {
      try {
        new URL(input);
        return true;
      } catch {
        return 'Please enter a valid URL';
      }
    }
  },
  {
    type: 'input',
    name: 'wpUsername',
    message: 'WordPress Username:',
    validate: (input) => input.length > 0 || 'Username is required'
  },
  {
    type: 'password',
    name: 'wpPassword',
    message: 'WordPress Application Password:',
    validate: (input) => input.length > 0 || 'Application Password is required'
  },
  {
    type: 'input',
    name: 'categories',
    message: 'Categories (comma-separated, e.g., News, Technology):',
    default: 'News',
    filter: (input) => input.split(',').map(c => c.trim()).filter(c => c)
  },
  {
    type: 'confirm',
    name: 'testConnection',
    message: 'Test connection after saving?',
    default: true
  }
];

async function testConnection(url, username, password) {
  const auth = Buffer.from(`${username}:${password}`).toString('base64');

  try {
    const response = await fetch(`${url}?per_page=1`, {
      headers: { 'Authorization': `Basic ${auth}` }
    });

    if (response.ok) {
      return { success: true, message: 'Connection successful!' };
    } else if (response.status === 401) {
      return { success: false, message: 'Authentication failed. Check your username and Application Password.' };
    } else {
      return { success: false, message: `HTTP ${response.status}: ${response.statusText}` };
    }
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function updateConfig(configPath, answers) {
  let config = {};

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('Failed to read config, creating new one');
    }
  }

  config.endpoints = config.endpoints || {};
  config.endpoints.wordpress = {
    url: answers.wpUrl,
    auth: {
      username: answers.wpUsername,
      password: answers.wpPassword
    }
  };

  config.publish = config.publish || {};
  config.publish.categories = answers.categories;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return config;
}

async function main() {
  console.log('\n=== RCPosty WordPress Setup ===\n');
  console.log('This script will help you configure WordPress publishing.\n');
  console.log('To create an Application Password:');
  console.log('1. Go to WordPress Admin → Users → Profile');
  console.log('2. Find "Application Passwords" section');
  console.log('3. Enter a name (e.g., "RC Posty") and click "Add New"');
  console.log('4. Copy the generated password\n');

  const configPath = path.join(__dirname, '../config/default.json');
  const answers = await inquirer.prompt(questions);

  console.log('\nSaving configuration...');
  const config = await updateConfig(configPath, answers);
  console.log('✓ Configuration saved\n');

  if (answers.testConnection) {
    console.log('Testing connection...');
    const result = await testConnection(answers.wpUrl, answers.wpUsername, answers.wpPassword);

    if (result.success) {
      console.log('✓ ' + result.message);
      console.log('\nYou can now publish articles to WordPress!');
    } else {
      console.log('✗ ' + result.message);
      console.log('\nTroubleshooting:');
      console.log('1. Make sure you\'re using an Application Password, not your regular password');
      console.log('2. Check that REST API is enabled in WordPress');
      console.log('3. Verify the username is correct');
    }
  }
}

if (process.argv[1] === __filename) {
  main().catch(console.error);
}
