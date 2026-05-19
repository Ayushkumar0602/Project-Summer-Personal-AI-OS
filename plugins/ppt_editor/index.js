const { planSlides } = require('./lib/slide-planner');
const { writeContent } = require('./lib/content-writer');
const { handleAssets } = require('./lib/asset-handler');
const { buildPPTX } = require('./lib/pptx-builder');
const path = require('path');
const fs = require('node:fs');
const os = require('node:os');
const driveService = require('../../src/services/drive-service');
const { isAuthenticated } = require('../../src/auth/google-auth');

async function main(taskManifest, sdk) {
  try {
    sdk.reportProgress(5, 'Planning slide structure...');
    const plan = await planSlides(taskManifest);
    sdk.reportProgress(20, `Planned ${plan.length} slides`);

    sdk.reportProgress(25, 'Writing slide content...');
    const enrichedXml = await writeContent(plan, taskManifest);
    sdk.reportProgress(60, 'Content generated');

    sdk.reportProgress(65, 'Gathering images...');
    const withAssetsXml = await handleAssets(enrichedXml, taskManifest);
    sdk.reportProgress(80, 'Assets ready');

    sdk.reportProgress(85, 'Building .pptx file...');
    
    // Default output path (use a temp dir if on cloud, or desktop if local)
    const defaultOutputPath = path.join(os.tmpdir(), `Presentation_${Date.now()}.pptx`);
    const outputPath = taskManifest.output_path || defaultOutputPath;
    
    const finalPath = await buildPPTX(withAssetsXml, outputPath, taskManifest.color_theme || 'modern-dark');

    // Cloud Architecture: Problem C & 1 Solution -> Upload to Google Drive if connected
    if (await isAuthenticated()) {
        sdk.reportProgress(90, 'Uploading presentation to Google Drive...');
        const driveResult = await driveService.uploadFile(finalPath, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', true);
        sdk.reportProgress(100, 'Done');
        sdk.complete({ 
            message: `Presentation generated successfully and saved to Google Drive.`,
            file_path: finalPath,
            drive_url: driveResult.url 
        });
    } else {
        sdk.reportProgress(100, 'Done');
        sdk.complete({ file_path: finalPath, message: "Saved locally (Google Drive not connected)." });
    }
  } catch (error) {
    console.error('PPT Agent failed:', error);
    sdk.fail({ error: error.message, stage: error.stage || 'unknown' });
  }
}

module.exports = { main };
