const { planSlides } = require('./lib/slide-planner');
const { writeContent } = require('./lib/content-writer');
const { handleAssets } = require('./lib/asset-handler');
const { buildPPTX } = require('./lib/pptx-builder');
const path = require('path');

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
    
    // Default output path to user's desktop for this POC
    const defaultOutputPath = path.join(require('os').homedir(), 'Desktop', `Presentation_${Date.now()}.pptx`);
    const outputPath = taskManifest.output_path || defaultOutputPath;
    
    const finalPath = await buildPPTX(withAssetsXml, outputPath, taskManifest.color_theme || 'modern-dark');

    sdk.reportProgress(100, 'Done');
    sdk.complete({ file_path: finalPath });
  } catch (error) {
    console.error('PPT Agent failed:', error);
    sdk.fail({ error: error.message, stage: error.stage || 'unknown' });
  }
}

module.exports = { main };
