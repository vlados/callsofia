#!/usr/bin/env node
import * as dotenv from 'dotenv';
import { CallSofiaClient } from './client.js';
import type { ScraperConfig } from './types.js';

dotenv.config();

async function testConnection(): Promise<void> {
  console.log('\n=== CallSofia Connection Test ===\n');

  // Load config from environment
  const config: Partial<ScraperConfig> = {
    cookies: {
      aspxAuth: process.env.ASPX_AUTH || '',
      requestVerificationToken: process.env.REQUEST_VERIFICATION_TOKEN || '',
      sessionToken: process.env.SESSION_TOKEN,
    },
  };

  // Check for required cookies
  if (!config.cookies?.aspxAuth) {
    console.error('Missing ASPX_AUTH cookie in .env file');
    process.exit(1);
  }
  if (!config.cookies?.requestVerificationToken) {
    console.error('Missing REQUEST_VERIFICATION_TOKEN cookie in .env file');
    process.exit(1);
  }

  console.log('Cookies configured:');
  console.log(`  - ASPX_AUTH: ${config.cookies.aspxAuth.substring(0, 20)}...`);
  console.log(`  - REQUEST_VERIFICATION_TOKEN: ${config.cookies.requestVerificationToken.substring(0, 20)}...`);
  if (config.cookies.sessionToken) {
    console.log(`  - SESSION_TOKEN: ${config.cookies.sessionToken.substring(0, 20)}...`);
  }

  const client = new CallSofiaClient(config);

  // Test 1: Fetch categories
  console.log('\n1. Testing categories endpoint...');
  try {
    const categories = await client.getCategories();
    if (categories.length > 0) {
      console.log(`   OK - Found ${categories.length} categories`);
      console.log(`   Sample: ${categories[0].name} (ID: ${categories[0].id})`);
    } else {
      console.log('   FAIL - No categories returned');
    }
  } catch (error) {
    console.log(`   FAIL - ${(error as Error).message}`);
  }

  // Test 2: Fetch subcategories
  console.log('\n2. Testing subcategories endpoint...');
  try {
    const subcategories = await client.getSubcategories();
    if (subcategories.length > 0) {
      console.log(`   OK - Found ${subcategories.length} subcategories`);

      // Find bicycle infrastructure
      const bicycle = subcategories.find(s => s.id === 30271);
      if (bicycle) {
        console.log(`   Bicycle Infrastructure found: "${bicycle.fullName}" (ID: ${bicycle.id})`);
      }
    } else {
      console.log('   FAIL - No subcategories returned');
    }
  } catch (error) {
    console.log(`   FAIL - ${(error as Error).message}`);
  }

  // Test 3: Fetch a signal
  console.log('\n3. Testing signal details endpoint...');
  try {
    const html = await client.getSignalDetailsHtml(1);
    if (html && html.length > 0 && !html.includes('Няма регистриран сигнал')) {
      console.log(`   OK - Signal #1 retrieved (${html.length} bytes)`);
    } else {
      console.log('   FAIL - Signal #1 not found or empty');
    }
  } catch (error) {
    console.log(`   FAIL - ${(error as Error).message}`);
  }

  // Test 4: Fetch a recent signal
  console.log('\n4. Testing recent signal...');
  try {
    const html = await client.getSignalDetailsHtml(676000);
    if (html && html.length > 0 && !html.includes('Няма регистриран сигнал')) {
      console.log(`   OK - Signal #676000 retrieved (${html.length} bytes)`);
    } else {
      console.log('   INFO - Signal #676000 not found (might not exist yet)');
    }
  } catch (error) {
    console.log(`   FAIL - ${(error as Error).message}`);
  }

  // Test 5: Fetch status history
  console.log('\n5. Testing status history endpoint...');
  try {
    const history = await client.getStatusHistory(1);
    if (history.length > 0) {
      console.log(`   OK - Found ${history.length} status entries for signal #1`);
      console.log(`   Last status: ${history[0].status} (${history[0].date})`);
    } else {
      console.log('   INFO - No status history for signal #1');
    }
  } catch (error) {
    console.log(`   FAIL - ${(error as Error).message}`);
  }

  console.log('\n=== Connection Test Complete ===\n');
}

testConnection().catch(console.error);
