import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import cloud from 'd3-cloud';

const WordCloudTest = () => {
  const svgRef = useRef();
  const [selectedExample, setSelectedExample] = useState('basic');

  // Sample wavelength data for testing (20 words each)
  const sampleData = {
    basic: [
      { text: 'love', size: 70 },
      { text: 'happiness', size: 68 },
      { text: 'joy', size: 65 },
      { text: 'peace', size: 62 },
      { text: 'harmony', size: 58 },
      { text: 'bliss', size: 55 },
      { text: 'contentment', size: 52 },
      { text: 'serenity', size: 48 },
      { text: 'delight', size: 45 },
      { text: 'warmth', size: 42 },
      { text: 'compassion', size: 38 },
      { text: 'gratitude', size: 35 },
      { text: 'kindness', size: 32 },
      { text: 'hope', size: 30 },
      { text: 'empathy', size: 28 },
      { text: 'trust', size: 25 },
      { text: 'comfort', size: 22 },
      { text: 'affection', size: 20 },
      { text: 'excitement', size: 18 },
      { text: 'enthusiasm', size: 15 }
    ],
    technology: [
      { text: 'innovation', size: 72 },
      { text: 'artificial', size: 68 },
      { text: 'intelligence', size: 65 },
      { text: 'automation', size: 62 },
      { text: 'digital', size: 58 },
      { text: 'future', size: 55 },
      { text: 'progress', size: 52 },
      { text: 'advancement', size: 48 },
      { text: 'efficiency', size: 45 },
      { text: 'connectivity', size: 42 },
      { text: 'transformation', size: 38 },
      { text: 'data', size: 35 },
      { text: 'cloud', size: 32 },
      { text: 'cybersecurity', size: 30 },
      { text: 'blockchain', size: 28 },
      { text: 'quantum', size: 25 },
      { text: 'robotics', size: 22 },
      { text: 'virtual', size: 20 },
      { text: 'disruption', size: 18 },
      { text: 'algorithm', size: 15 }
    ],
    nature: [
      { text: 'forest', size: 70 },
      { text: 'ocean', size: 68 },
      { text: 'mountains', size: 65 },
      { text: 'wildlife', size: 62 },
      { text: 'rivers', size: 58 },
      { text: 'trees', size: 55 },
      { text: 'flowers', size: 52 },
      { text: 'sunshine', size: 48 },
      { text: 'fresh', size: 45 },
      { text: 'green', size: 42 },
      { text: 'natural', size: 38 },
      { text: 'ecosystem', size: 35 },
      { text: 'biodiversity', size: 32 },
      { text: 'rainforest', size: 30 },
      { text: 'meadow', size: 28 },
      { text: 'breeze', size: 25 },
      { text: 'waterfall', size: 22 },
      { text: 'sunset', size: 20 },
      { text: 'wilderness', size: 18 },
      { text: 'landscape', size: 15 }
    ]
  };

  const createWordCloud = (words, colorScheme = 'category10') => {
    // Clear previous content
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current);
    const width = 800;
    const height = 500;
    
    svg.attr("width", width).attr("height", height);

    // Color schemes
    const colorSchemes = {
      category10: d3.scaleOrdinal(d3.schemeCategory10),
      blues: d3.scaleSequential(d3.interpolateBlues).domain([0, words.length]),
      warm: d3.scaleSequential(d3.interpolateWarm).domain([0, words.length]),
      cool: d3.scaleSequential(d3.interpolateCool).domain([0, words.length]),
      viridis: d3.scaleSequential(d3.interpolateViridis).domain([0, words.length])
    };

    const color = colorSchemes[colorScheme] || colorSchemes.category10;

    const layout = cloud()
      .size([width, height])
      .words(words.map(d => ({ ...d, size: d.size })))
      .padding(5)
      .rotate(() => ~~(Math.random() * 2) * 90) // 0 or 90 degrees
      .font("Impact")
      .fontSize(d => d.size)
      .on("end", draw);

    layout.start();

    function draw(words) {
      const g = svg.append("g")
        .attr("transform", `translate(${width/2},${height/2})`);

      const text = g.selectAll("text")
        .data(words)
        .enter().append("text")
        .style("font-size", d => `${d.size}px`)
        .style("font-family", "Impact")
        .style("fill", (d, i) => {
          if (colorScheme === 'category10') {
            return color(i);
          } else {
            return color(i);
          }
        })
        .style("cursor", "pointer")
        .attr("text-anchor", "middle")
        .attr("transform", d => `translate(${d.x},${d.y})rotate(${d.rotate})`)
        .text(d => d.text)
        .on("mouseover", function(event, d) {
          d3.select(this).style("opacity", 0.7);
        })
        .on("mouseout", function(event, d) {
          d3.select(this).style("opacity", 1);
        })
        .on("click", function(event, d) {
          console.log(`Clicked word: ${d.text} (size: ${d.size})`);
        });

      // Add animation
      text.style("opacity", 0)
        .transition()
        .duration(1000)
        .style("opacity", 1);
    }
  };

  useEffect(() => {
    createWordCloud(sampleData[selectedExample]);
  }, [selectedExample]);

  const colorSchemes = ['category10', 'blues', 'warm', 'cool', 'viridis'];
  const [currentColorScheme, setCurrentColorScheme] = useState('category10');

  const regenerateCloud = (colorScheme) => {
    setCurrentColorScheme(colorScheme);
    createWordCloud(sampleData[selectedExample], colorScheme);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Wavelength Word Cloud Test</h1>
      <p>Testing d3-cloud for visualizing wavelength game results</p>

      {/* Controls */}
      <div style={{ marginBottom: '20px', padding: '15px', background: '#f5f5f5', borderRadius: '8px' }}>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ fontWeight: 'bold', marginRight: '10px' }}>Sample Data:</label>
          {Object.keys(sampleData).map(key => (
            <button
              key={key}
              onClick={() => setSelectedExample(key)}
              style={{
                margin: '0 5px',
                padding: '8px 16px',
                backgroundColor: selectedExample === key ? '#007bff' : '#fff',
                color: selectedExample === key ? '#fff' : '#000',
                border: '1px solid #ccc',
                borderRadius: '4px',
                cursor: 'pointer',
                textTransform: 'capitalize'
              }}
            >
              {key}
            </button>
          ))}
        </div>

        <div>
          <label style={{ fontWeight: 'bold', marginRight: '10px' }}>Color Scheme:</label>
          {colorSchemes.map(scheme => (
            <button
              key={scheme}
              onClick={() => regenerateCloud(scheme)}
              style={{
                margin: '0 5px',
                padding: '8px 16px',
                backgroundColor: currentColorScheme === scheme ? '#28a745' : '#fff',
                color: currentColorScheme === scheme ? '#fff' : '#000',
                border: '1px solid #ccc',
                borderRadius: '4px',
                cursor: 'pointer',
                textTransform: 'capitalize'
              }}
            >
              {scheme}
            </button>
          ))}
        </div>
      </div>

      {/* Word Cloud Container */}
      <div style={{ 
        border: '2px solid #ddd', 
        borderRadius: '8px', 
        background: '#fff',
        textAlign: 'center',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <svg ref={svgRef}></svg>
      </div>

      {/* Info Panel */}
      <div style={{ marginTop: '20px', padding: '15px', background: '#e8f4f8', borderRadius: '8px' }}>
        <h3>Current Configuration:</h3>
        <ul style={{ margin: 0, paddingLeft: '20px' }}>
          <li><strong>Dataset:</strong> {selectedExample} ({sampleData[selectedExample].length} words)</li>
          <li><strong>Color Scheme:</strong> {currentColorScheme}</li>
          <li><strong>Layout:</strong> Random rotation (0° or 90°)</li>
          <li><strong>Font:</strong> Impact</li>
          <li><strong>Interactions:</strong> Hover effects and click events</li>
        </ul>
      </div>

      {/* Notes */}
      <div style={{ marginTop: '20px', padding: '15px', background: '#fff3cd', borderRadius: '8px' }}>
        <h3>Implementation Notes:</h3>
        <ul style={{ margin: 0, paddingLeft: '20px' }}>
          <li>Words are sized based on frequency/relevance from wavelength responses</li>
          <li>Layout automatically handles collisions and positioning</li>
          <li>Multiple color schemes available for different themes</li>
          <li>Hover and click interactions for potential drill-down functionality</li>
          <li>Smooth fade-in animation on render</li>
          <li>Responsive SVG container for different screen sizes</li>
        </ul>
      </div>
    </div>
  );
};

export default WordCloudTest;