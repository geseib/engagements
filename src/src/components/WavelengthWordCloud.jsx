import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import cloud from 'd3-cloud';
import Icon from './Icon';

const WavelengthWordCloud = ({ answers, promptWord, gameState }) => {
  const svgRef = useRef();
  const [wordFrequency, setWordFrequency] = useState({});
  const [allWords, setAllWords] = useState([]);
  const [playerCount, setPlayerCount] = useState(0);

  useEffect(() => {
    if (!answers || answers.length === 0) return;

    // Process answers to create word frequency dictionary
    const wordFrequency = {};
    let totalWords = 0;
    let allWords = []; // Track all words for the complete list

    answers.forEach(answer => {
      // Parse the comma-separated words from each player's answer
      const words = answer.answer ? answer.answer.split(',')
        .map(word => word.trim().toLowerCase())
        .filter(word => word.length > 0) : [];
      
      words.forEach(word => {
        wordFrequency[word] = (wordFrequency[word] || 0) + 1;
        totalWords++;
        allWords.push({ word, player: answer.player });
      });
    });

    // If fewer than 5 players, multiply word frequency by 3 for better distinction
    const playerCount = answers.length;
    const frequencyMultiplier = playerCount < 5 ? 3 : 1;
    
    if (frequencyMultiplier > 1) {
      console.log(`🔢 Fewer than 5 players (${playerCount}), multiplying word frequencies by ${frequencyMultiplier}`);
      Object.keys(wordFrequency).forEach(word => {
        wordFrequency[word] *= frequencyMultiplier;
      });
    }

    // Update state for display
    setWordFrequency(wordFrequency);
    setAllWords(allWords);
    setPlayerCount(playerCount);

    console.log('🎨 Wavelength Word Cloud - Word frequency:', wordFrequency);
    console.log('🎯 Prompt word:', promptWord, 'Total words:', totalWords);
    console.log('📝 All words submitted:', allWords);

    // Create word data array
    const wordData = [];
    
    // Add the prompt word as the dominant element (size = sum of all others)
    if (promptWord) {
      wordData.push({
        text: promptWord.toUpperCase(),
        size: Math.min(150, 80 + totalWords * 2), // Scale based on total words but cap at 150
        weight: totalWords,
        isPrompt: true
      });
    }

    // Add player words with sizes based on frequency
    const maxFreq = Math.max(...Object.values(wordFrequency), 1);
    Object.entries(wordFrequency).forEach(([word, freq]) => {
      wordData.push({
        text: word,
        size: Math.max(12, Math.min(50, 15 + (freq / maxFreq) * 35)), // Scale between 12-50px
        weight: freq,
        isPrompt: false
      });
    });

    // Sort by weight (frequency) for better layout
    wordData.sort((a, b) => b.weight - a.weight);

    console.log('📊 Word cloud data:', wordData);

    // Create the word cloud
    createWordCloud(wordData, allWords, wordFrequency);
  }, [answers, promptWord, gameState]);

  const createWordCloud = (words, allWords, wordFrequency) => {
    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current);
    const width = 800;
    const height = 400;
    
    svg.attr('width', width).attr('height', height);

    // Warm Summit palette (token values as literals — d3 fills are data-driven)
    const engageColors = [
      '#F6A94C', // amber  (--primary)
      '#7CA7E6', // periwinkle (--secondary)
      '#4FB286', // teal   (--success)
      '#C77B4A', // deep amber (--primary-deep)
      '#F4EDE4', // warm paper-white (--text)
      '#9BA8BE', // slate muted (--muted)
      '#B4794A', // bronze
      '#C0C6D0', // silver
      '#2E4262', // ridge-back
      '#25375A'  // surface-2
    ];

    const color = (d, i) => {
      // Prompt word gets the hero amber accent
      if (d.isPrompt) return '#F6A94C';
      // Other words cycle through the warm palette
      return engageColors[i % engageColors.length];
    };

    const layout = cloud()
      .size([width, height])
      .words(words.map(d => ({ ...d })))
      .padding(5)
      .rotate(() => ~~(Math.random() * 2) * 90) // 0 or 90 degrees
      .font('Impact')
      .fontSize(d => d.size)
      .on('end', draw);

    layout.start();

    function draw(words) {
      const g = svg.append('g')
        .attr('transform', `translate(${width/2},${height/2})`);

      const text = g.selectAll('text')
        .data(words)
        .enter().append('text')
        .style('font-size', d => `${d.size}px`)
        .style('font-family', 'Impact')
        .style('font-weight', d => d.isPrompt ? '900' : 'bold')
        .style('fill', (d, i) => color(d, i))
        .style('cursor', 'pointer')
        .attr('text-anchor', 'middle')
        .attr('transform', d => `translate(${d.x},${d.y})rotate(${d.rotate})`)
        .text(d => d.text)
        .on('mouseover', function(event, d) {
          d3.select(this).style('opacity', 0.7);
          // Show tooltip with frequency
          const tooltip = d3.select('body').append('div')
            .attr('class', 'word-cloud-tooltip')
            .style('position', 'absolute')
            .style('background', 'rgba(0,0,0,0.8)')
            .style('color', 'white')
            .style('padding', '4px 8px')
            .style('border-radius', '4px')
            .style('font-size', '12px')
            .style('pointer-events', 'none')
            .style('z-index', '9999');
          
          if (d.isPrompt) {
            tooltip.html(`<strong>Prompt Word</strong>`);
          } else {
            tooltip.html(`"${d.text}"<br/>Mentioned ${d.weight} time${d.weight !== 1 ? 's' : ''}`);
          }
          
          tooltip.style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 20) + 'px');
        })
        .on('mouseout', function(event, d) {
          d3.select(this).style('opacity', 1);
          d3.selectAll('.word-cloud-tooltip').remove();
        });

      // Animate in with staggered fade
      text.style('opacity', 0)
        .transition()
        .duration(800)
        .delay((d, i) => i * 30)
        .style('opacity', 1);
    }
  };

  return (
    <div className="wavelength-word-cloud">
      <div style={{ 
        background: 'white',
        borderRadius: '12px',
        padding: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        textAlign: 'center'
      }}>
        <h3 style={{ marginBottom: '16px', color: '#333' }}>
          <Icon name="Waves" weight="duotone" size={16} color="var(--secondary)" /> Wavelength Word Cloud
        </h3>
        <svg ref={svgRef}></svg>
        <div style={{ 
          marginTop: '12px',
          fontSize: '14px',
          color: '#666',
          fontStyle: 'italic'
        }}>
          {answers?.length || 0} players contributed words
          {playerCount > 0 && playerCount < 5 && (
            <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
              Word sizes enhanced 3x for better visibility with fewer players
            </div>
          )}
        </div>
        
        {/* Complete word list */}
        {Object.keys(wordFrequency).length > 0 && (
          <div style={{
            marginTop: '20px',
            padding: '16px',
            background: '#f8f9fa',
            borderRadius: '8px',
            textAlign: 'left'
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#333', fontSize: '16px' }}>
              <Icon name="NotePencil" weight="bold" size={16} color="currentColor" /> Complete Word List ({Object.keys(wordFrequency).length} unique words)
            </h4>
            <div style={{ 
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              fontSize: '14px'
            }}>
              {Object.entries(wordFrequency)
                .sort(([,a], [,b]) => b - a) // Sort by frequency (descending)
                .map(([word, freq]) => {
                  const actualFreq = playerCount < 5 ? Math.round(freq / 3) : freq;
                  return (
                    <span
                      key={word}
                      style={{
                        background: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid #ddd',
                        color: '#333',
                        fontSize: freq > (playerCount < 5 ? 6 : 2) ? '14px' : '12px',
                        fontWeight: freq > (playerCount < 5 ? 6 : 2) ? '600' : 'normal'
                      }}
                      title={`Mentioned ${actualFreq} time${actualFreq !== 1 ? 's' : ''}`}
                    >
                      {word} <span style={{ color: '#666', fontSize: '11px' }}>({actualFreq})</span>
                    </span>
                  );
                })
              }
            </div>
            
            {/* Show all words chronologically */}
            <details style={{ marginTop: '16px' }}>
              <summary style={{ 
                cursor: 'pointer',
                color: 'var(--secondary)',
                fontSize: '14px',
                fontWeight: '500'
              }}>
                View all words by player
              </summary>
              <div style={{ 
                marginTop: '12px',
                padding: '12px',
                background: 'white',
                borderRadius: '4px',
                border: '1px solid #e0e0e0'
              }}>
                {allWords.map((item, idx) => (
                  <span 
                    key={idx}
                    style={{ 
                      display: 'inline-block',
                      margin: '2px 4px',
                      padding: '2px 6px',
                      background: '#f0f0f0',
                      borderRadius: '3px',
                      fontSize: '12px',
                      color: '#555'
                    }}
                    title={`By ${item.player}`}
                  >
                    {item.word}
                  </span>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
};

export default WavelengthWordCloud;