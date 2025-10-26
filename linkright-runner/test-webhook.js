/**
 * Test script to verify fetch works from Node.js
 * This isolates whether the issue is with Node's fetch or the runner's logic
 *
 * This test sends THREE payloads of different sizes to identify if size is the issue:
 * 1. Small payload (500 bytes) - baseline
 * 2. Medium payload (15 KB) - typical post
 * 3. Large payload (36 KB) - matches your failing logs
 */

// Generate realistic HTML similar to LinkedIn posts
const generateFakeLinkedInHTML = (size) => {
  const baseHTML = `<div class="feed-shared-update-v2" data-id="urn:li:activity:7387195610858369024">
  <div class="update-components-header">
    <div class="update-components-actor">
      <a class="update-components-actor__meta-link">
        <span class="update-components-actor__name">Test Author</span>
        <span class="update-components-actor__description">CEO at Test Company • 3rd+</span>
      </a>
    </div>
  </div>
  <div class="feed-shared-update-v2__description">
    <div class="feed-shared-text">
      <span>This is a test LinkedIn post content. `;

  // Pad to desired size with realistic content
  const padding = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(Math.ceil(size / 60));
  const closeHTML = `</span>
    </div>
  </div>
  <div class="social-details-social-counts">
    <button class="reactions-react-button">
      <span class="reactions-react-button__text">Like</span>
    </button>
  </div>
</div>`;

  return (baseHTML + padding + closeHTML).substring(0, size);
};

const testWebhook = async (payloadSize, label, timeout = 30000) => {
  const url = 'https://n8n.linkright.in/webhook/linkedin-parse';

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔍 Test ${label}: ${payloadSize} bytes`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('URL:', url);
  console.log('Timeout:', timeout + 'ms');

  const testPayload = {
    outer_html: generateFakeLinkedInHTML(payloadSize)
  };

  const actualSize = JSON.stringify(testPayload).length;
  console.log('Target size:', payloadSize, 'bytes');
  console.log('Actual size:', actualSize, 'bytes');

  try {
    console.log('\n⏳ Sending request...');
    const startTime = Date.now();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload),
      signal: AbortSignal.timeout(timeout)
    });

    const duration = Date.now() - startTime;

    console.log('\n✅ Response received');
    console.log('Status:', response.status, response.statusText);
    console.log('Duration:', duration + 'ms');
    console.log('Headers:', Object.fromEntries(response.headers.entries()));

    const responseText = await response.text();
    console.log('\nResponse Body (first 200 chars):');
    console.log(responseText.substring(0, 200));

    // Try to parse as JSON
    try {
      const json = JSON.parse(responseText);
      console.log('\nParsed JSON:');
      console.log(JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('(Not valid JSON)');
    }

    console.log(`\n✅ ${label} test PASSED (${duration}ms)`);
    return { success: true, duration };

  } catch (error) {
    const duration = Date.now() - startTime;

    console.error(`\n❌ ${label} test FAILED (${duration}ms)`);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);

    if (error.cause) {
      console.error('\n🔍 Error Cause (CRITICAL):');
      console.error('  Message:', error.cause.message);
      console.error('  Code:', error.cause.code);
      console.error('  Errno:', error.cause.errno);
      console.error('  Syscall:', error.cause.syscall);
      console.error('  Full:', error.cause);
    }

    console.error('\nStack:', error.stack);

    return { success: false, duration, error: error.message };
  }
};

// Run all tests
const runAllTests = async () => {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  LinkedIn Parse Webhook Test Suite       ║');
  console.log('╚═══════════════════════════════════════════╝');

  const results = [];

  // Test 1: Small payload (baseline)
  results.push(await testWebhook(500, 'Small (500B)', 30000));

  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between tests

  // Test 2: Medium payload
  results.push(await testWebhook(15000, 'Medium (15KB)', 30000));

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 3: Large payload with 180s timeout (matches new runner config)
  results.push(await testWebhook(36000, 'Large (36KB) - 180s timeout', 180000));

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 4: Large with 10s timeout (old behavior - should fail if webhook is slow)
  results.push(await testWebhook(36000, 'Large (36KB) - 10s timeout (OLD)', 10000));

  console.log('\n\n╔═══════════════════════════════════════════╗');
  console.log('║             Test Summary                  ║');
  console.log('╚═══════════════════════════════════════════╝');
  results.forEach((r, i) => {
    const status = r.success ? '✅ PASS' : '❌ FAIL';
    console.log(`Test ${i + 1}: ${status} (${r.duration}ms)`);
  });

  const allPassed = results.every(r => r.success);
  if (allPassed) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log('\n⚠️  Some tests failed - check details above');
  }
};

// Run the test suite
runAllTests().catch(console.error);
