const pptxgen = require('pptxgenjs');
const xml2js = require('xml2js');

async function buildPPTX(xmlString, outputPath, themeName = 'modern-dark') {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9';

  // Basic Theme settings
  const themes = {
    'modern-dark': { bg: '1E1E1E', fg: 'FFFFFF', accent: '3B82F6' },
    'corporate-clean': { bg: 'FFFFFF', fg: '333333', accent: '0056B3' }
  };
  const theme = themes[themeName] || themes['modern-dark'];

  const parser = new xml2js.Parser({ explicitArray: false });
  let presentation;
  try {
    presentation = await parser.parseStringPromise(xmlString);
  } catch (e) {
    throw new Error('Failed to parse final XML structure: ' + e.message);
  }

  const root = presentation.PRESENTATION || presentation;

  // Title Slide
  if (root.TITLE_SLIDE) {
    const slide = pptx.addSlide();
    slide.background = { color: theme.bg };
    
    slide.addText(root.TITLE_SLIDE.H1 || 'Presentation', {
      x: 1, y: 2, w: '80%', h: 1.5,
      fontSize: 44, color: theme.fg, bold: true, align: 'center'
    });
    
    if (root.TITLE_SLIDE.P) {
      slide.addText(root.TITLE_SLIDE.P, {
        x: 1, y: 3.5, w: '80%', h: 1,
        fontSize: 24, color: theme.fg, align: 'center'
      });
    }
  }

  // Content Slides
  const sections = Array.isArray(root.SECTION) ? root.SECTION : (root.SECTION ? [root.SECTION] : []);

  for (const section of sections) {
    const slide = pptx.addSlide();
    slide.background = { color: theme.bg };
    
    const layout = section.$ ? section.$.layout : 'left'; // left, right, vertical
    
    // Default image area
    let imgOptions = { x: 0.5, y: 0.5, w: 4, h: 4.5 };
    let contentOptions = { x: 5, y: 0.5, w: 4.5, h: 4.5 };
    
    if (layout === 'right') {
      imgOptions = { x: 5.5, y: 0.5, w: 4, h: 4.5 };
      contentOptions = { x: 0.5, y: 0.5, w: 4.5, h: 4.5 };
    } else if (layout === 'vertical') {
      imgOptions = { x: 0.5, y: 0.5, w: 9, h: 2.5 };
      contentOptions = { x: 0.5, y: 3.5, w: 9, h: 2 };
    }

    // Process Image
    if (section.IMG && section.IMG.$ && section.IMG.$.url) {
      slide.addImage({
        path: section.IMG.$.url,
        ...imgOptions,
        sizing: { type: 'cover' }
      });
    } else {
        // Placeholder if no image
        slide.addShape(pptx.ShapeType.rect, {
            ...imgOptions, fill: { color: 'CCCCCC' }
        });
    }

    // Process Components
    const comps = ['COLUMNS', 'BULLETS', 'ICONS', 'CYCLE', 'ARROWS', 'BOXES'];
    let foundComp = null;
    let compData = null;
    
    for (const c of comps) {
      if (section[c]) {
        foundComp = c;
        compData = Array.isArray(section[c].DIV) ? section[c].DIV : [section[c].DIV];
        break;
      }
    }

    if (foundComp && compData) {
      let currentY = contentOptions.y;
      
      for (const div of compData) {
        if (!div) continue;
        
        if (div.H3) {
          slide.addText(div.H3, {
            x: contentOptions.x, y: currentY, w: contentOptions.w, h: 0.5,
            fontSize: 20, color: theme.accent, bold: true
          });
          currentY += 0.5;
        }
        
        if (div.P) {
          slide.addText(div.P, {
            x: contentOptions.x, y: currentY, w: contentOptions.w, h: 1.0,
            fontSize: 14, color: theme.fg
          });
          currentY += 1.0;
        }
        currentY += 0.2; // Spacing
      }
    } else {
        // Fallback
        slide.addText("Missing layout component", {
            x: contentOptions.x, y: contentOptions.y, w: contentOptions.w, h: 1,
            color: 'FF0000'
        });
    }
  }

  await pptx.writeFile({ fileName: outputPath });
  return outputPath;
}

module.exports = { buildPPTX };
