document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // DOM Elements
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const turtleEl = document.getElementById('turtle');
    const codeArea = document.getElementById('codeArea');
    const logDiv = document.getElementById('log');
    const statusEl = document.getElementById('status');

    // State
    let turtle = {
        x: canvas.width / 2,
        y: canvas.height / 2,
        angle: 90,
        pen: true,
        color: '#000000',
        width: 2,
        visible: true
    };

    let userProcedures = {};
    let variables = {};
    let savedCode = '';
    let isRunning = false;
    let shouldStop = false;
    let executionSpeed = 5;
    let currentLine = -1;
    let codeLines = [];
    let executionQueue = [];

    const colors = {
        red: '#FF0000',
        blue: '#0000FF',
        green: '#00FF00',
        yellow: '#FFFF00',
        orange: '#FFA500',
        purple: '#800080',
        pink: '#FFC0CB',
        brown: '#A52A2A',
        black: '#000000',
        white: '#FFFFFF',
        gray: '#808080',
        cyan: '#00FFFF',
        magenta: '#FF00FF'
    };

    // --- Core Functions ---

    function updateStatus(msg) {
        statusEl.textContent = msg;
    }

    function log(msg) {
        logDiv.innerHTML += msg + '<br>';
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    function clearLog() {
        logDiv.innerHTML = '';
    }

    function resetTurtle() {
        turtle.x = canvas.width / 2;
        turtle.y = canvas.height / 2;
        turtle.angle = 90;
        turtle.pen = true;
        turtle.color = '#000000';
        turtle.width = 2;
        turtle.visible = true;
        updateTurtlePosition();
        updateTurtleColor();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function updateTurtlePosition() {
        const rect = canvas.getBoundingClientRect();
        const wrapRect = document.getElementById('canvasWrap').getBoundingClientRect();
        const x = (rect.left - wrapRect.left) + turtle.x;
        const y = (rect.top - wrapRect.top) + turtle.y;

        const transitionTime = Math.max(50, 1000 / executionSpeed);
        turtleEl.style.transition = `all ${transitionTime}ms ease`;

        turtleEl.style.backgroundColor = turtle.color;
        turtleEl.style.boxShadow = `0 0 10px ${turtle.color}50`;

        turtleEl.style.left = x + 'px';
        turtleEl.style.top = y + 'px';

        turtleEl.style.transform = `translate(-10px, -10px)`;
        turtleEl.style.setProperty('--rotation', `${turtle.angle}deg`);
        turtleEl.style.display = turtle.visible ? 'block' : 'none';
    }

    function updateTurtleColor() {
        turtleEl.style.setProperty('--triangle-color', '#333333');
    }

    function highlightCurrentLine(lineNumber) {
        const oldHighlight = document.querySelector('.highlight-line');
        if (oldHighlight) {
            oldHighlight.classList.remove('highlight-line');
        }

        if (lineNumber >= 0 && lineNumber < codeLines.length) {
            const lineElements = document.querySelectorAll('#codeDisplay .code-line');
            if (lineElements[lineNumber]) {
                lineElements[lineNumber].classList.add('highlight-line');
            }
        }
    }

    function updateCodeDisplay() {
        const code = codeArea.value;
        codeLines = code.split('\n');
        const codeDisplay = document.getElementById('codeDisplay');

        const html = codeLines.map((line, index) =>
            `<div class="code-line" data-line="${index}">${line || ' '}</div>`
        ).join('');

        codeDisplay.innerHTML = html;
        codeDisplay.style.display = isRunning ? 'block' : 'none';
        codeArea.style.display = isRunning ? 'none' : 'block';
    }

    function forward(distance) {
        return new Promise(resolve => {
            const rad = ((turtle.angle - 90) * Math.PI) / 180;
            const newX = turtle.x + distance * Math.cos(rad);
            const newY = turtle.y + distance * Math.sin(rad);

            if (turtle.pen) {
                ctx.strokeStyle = turtle.color;
                ctx.lineWidth = turtle.width;
                ctx.beginPath();
                ctx.moveTo(turtle.x, turtle.y);
                ctx.lineTo(newX, newY);
                ctx.stroke();
            }

            turtle.x = newX;
            turtle.y = newY;
            updateTurtlePosition();

            const delay = Math.max(50, 1000 / executionSpeed);
            setTimeout(resolve, delay);
        });
    }

    function turn(angle) {
        return new Promise(resolve => {
            turtle.angle = (turtle.angle + angle) % 360;
            updateTurtlePosition();

            const delay = Math.max(25, 500 / executionSpeed);
            setTimeout(resolve, delay);
        });
    }

    async function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function home() {
        return new Promise(resolve => {
            turtle.x = canvas.width / 2;
            turtle.y = canvas.height / 2;
            turtle.angle = 90;
            updateTurtlePosition();
            updateTurtleColor();
            setTimeout(resolve, Math.max(25, 500 / executionSpeed));
        });
    }

    function tokenize(code) {
        const lines = code.split('\n');
        const tokenizedLines = [];

        lines.forEach((line, lineIndex) => {
            const cleanLine = line.replace(/#[^\n]*/g, '').trim();
            if (cleanLine) {
                const tokens = cleanLine.split(/\s+/).filter(token => token.length > 0);
                tokens.forEach(token => {
                    tokenizedLines.push({
                        token: token,
                        lineNumber: lineIndex
                    });
                });
            }
        });

        return tokenizedLines;
    }

    function parseValue(token) {
        if (!token) return 0;
        if (token.startsWith(':')) {
            return variables[token.substring(1)] || 0;
        }
        const num = parseFloat(token);
        return isNaN(num) ? token : num;
    }

    async function executeCommand(command, arg, lineNumber = -1) {
        if (shouldStop) return;

        if (lineNumber >= 0) {
            highlightCurrentLine(lineNumber);
            await sleep(Math.max(100, 200 / executionSpeed));
        }

        const value = parseValue(arg);

        switch (command.toUpperCase()) {
            case 'FD':
            case 'FORWARD':
                await forward(value);
                break;
            case 'BK':
            case 'BACKWARD':
                await forward(-value);
                break;
            case 'RT':
            case 'RIGHT':
                await turn(value);
                break;
            case 'LT':
            case 'LEFT':
                await turn(-value);
                break;
            case 'PU':
            case 'PENUP':
                turtle.pen = false;
                await sleep(100);
                break;
            case 'PD':
            case 'PENDOWN':
                turtle.pen = true;
                await sleep(100);
                break;
            case 'SETCOLOR':
                turtle.color = colors[value.toString().toLowerCase()] || value;
                updateTurtleColor();
                await sleep(200);
                break;
            case 'SETWIDTH':
                turtle.width = value;
                await sleep(100);
                break;
            case 'CLEAR':
                resetTurtle();
                await sleep(200);
                break;
            case 'HOME':
                await home();
                break;
            case 'SHOW':
            case 'PRINT':
                log('Output: ' + value);
                await sleep(200);
                break;
            case 'HIDETURTLE':
            case 'HT':
                turtle.visible = false;
                updateTurtlePosition();
                await sleep(100);
                break;
            case 'SHOWTURTLE':
            case 'ST':
                turtle.visible = true;
                updateTurtlePosition();
                await sleep(100);
                break;
            default:
                if (userProcedures[command.toUpperCase()]) {
                    const proc = userProcedures[command.toUpperCase()];
                    if (proc.param) {
                        variables[proc.param] = value;
                    }
                    await executeTokens(proc.body);
                } else {
                    throw new Error('Unknown command: ' + command);
                }
        }
    }

    async function executeTokens(tokenizedInput) {
        let i = 0;

        let tokens = tokenizedInput;
        if (Array.isArray(tokenizedInput) && tokenizedInput.length > 0 && typeof tokenizedInput[0] === 'string') {
            tokens = tokenizedInput.map(token => ({
                token,
                lineNumber: -1
            }));
        }

        while (i < tokens.length && !shouldStop) {
            const tokenObj = tokens[i];
            const token = tokenObj.token;
            const lineNumber = tokenObj.lineNumber;

            if (token.toUpperCase() === 'TO') {
                i++;
                const name = tokens[i].token.toUpperCase();
                i++;
                let param = null;
                if (tokens[i] && tokens[i].token.startsWith(':')) {
                    param = tokens[i].token.substring(1);
                    i++;
                }

                const body = [];
                while (i < tokens.length && tokens[i].token.toUpperCase() !== 'END') {
                    body.push(tokens[i].token);
                    i++;
                }

                userProcedures[name] = {
                    param,
                    body
                };
            } else if (token.toUpperCase() === 'REPEAT') {
                if (lineNumber >= 0) {
                    highlightCurrentLine(lineNumber);
                    await sleep(Math.max(100, 200 / executionSpeed));
                }

                i++;
                const count = parseValue(tokens[i].token);
                i++;
                if (tokens[i].token !== '[') {
                    throw new Error('Expected [ after REPEAT');
                }
                i++;

                const body = [];
                let depth = 1;
                while (i < tokens.length && depth > 0) {
                    if (tokens[i].token === '[') depth++;
                    if (tokens[i].token === ']') depth--;
                    if (depth > 0) body.push(tokens[i].token);
                    i++;
                }

                for (let j = 0; j < count && !shouldStop; j++) {
                    await executeTokens(body.map(t => ({
                        token: t,
                        lineNumber: -1
                    })));
                }
            } else if (token.toUpperCase() === 'MAKE') {
                if (lineNumber >= 0) {
                    highlightCurrentLine(lineNumber);
                    await sleep(Math.max(100, 200 / executionSpeed));
                }

                i++;
                const varName = tokens[i].token.replace(/"/g, '');
                i++;
                const value = parseValue(tokens[i].token);
                variables[varName] = value;
                await sleep(100);
            } else if (token.toUpperCase() === 'IF') {
                if (lineNumber >= 0) {
                    highlightCurrentLine(lineNumber);
                    await sleep(Math.max(100, 200 / executionSpeed));
                }

                i++;
                const condition = parseValue(tokens[i].token);
                i++;
                if (tokens[i].token !== '[') {
                    throw new Error('Expected [ after IF condition');
                }
                i++;

                const body = [];
                let depth = 1;
                while (i < tokens.length && depth > 0) {
                    if (tokens[i].token === '[') depth++;
                    if (tokens[i].token === ']') depth--;
                    if (depth > 0) body.push(tokens[i].token);
                    i++;
                }

                if (condition) {
                    await executeTokens(body.map(t => ({
                        token: t,
                        lineNumber: -1
                    })));
                }
            } else {
                const nextToken = tokens[i + 1];
                await executeCommand(token, nextToken ? nextToken.token : undefined, lineNumber);
                if (nextToken && (nextToken.token.startsWith(':') || !isNaN(parseFloat(nextToken.token)) || colors[nextToken.token])) {
                    i++;
                }
            }
            i++;
        }
    }

    async function runProgram() {
        if (isRunning) return;

        clearLog();
        updateStatus('Running...');
        resetTurtle();
        userProcedures = {};
        variables = {};
        isRunning = true;
        shouldStop = false;

        document.getElementById('runBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;

        updateCodeDisplay();

        try {
            const code = codeArea.value;
            const tokens = tokenize(code);
            await executeTokens(tokens);

            if (!shouldStop) {
                updateStatus('Complete!');
                log('Program finished successfully!');
            } else {
                updateStatus('Stopped');
                log('Program stopped by user');
            }
        } catch (error) {
            updateStatus('Error');
            log('Error: ' + error.message);
        } finally {
            isRunning = false;
            shouldStop = false;
            highlightCurrentLine(-1);

            document.getElementById('runBtn').disabled = false;
            document.getElementById('stopBtn').disabled = true;

            updateCodeDisplay();
        }
    }

    function stopProgram() {
        shouldStop = true;
        updateStatus('Stopping...');
    }

    // --- Event Listeners ---

    document.getElementById('runBtn').addEventListener('click', runProgram);
    document.getElementById('stopBtn').addEventListener('click', stopProgram);

    document.getElementById('clearBtn').addEventListener('click', () => {
        resetTurtle();
        updateStatus('Canvas cleared');
        log('Canvas cleared');
    });

    const speedSlider = document.getElementById('speedSlider');
    const speedValue = document.getElementById('speedValue');

    speedSlider.addEventListener('input', (e) => {
        executionSpeed = parseInt(e.target.value);
        speedValue.textContent = executionSpeed;
    });

    document.getElementById('toggleTurtleBtn').addEventListener('click', () => {
        turtle.visible = !turtle.visible;
        updateTurtlePosition();
        const btn = document.getElementById('toggleTurtleBtn');
        btn.textContent = turtle.visible ? '👁️ Hide Turtle' : '👁️ Show Turtle';
        log(turtle.visible ? 'Turtle is now visible' : 'Turtle is now hidden');
    });

    document.getElementById('exportBtn').addEventListener('click', async () => {
        try {
            updateStatus('Exporting...');

            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = canvas.width;
            exportCanvas.height = canvas.height;
            const exportCtx = exportCanvas.getContext('2d');

            exportCtx.fillStyle = 'white';
            exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
            exportCtx.drawImage(canvas, 0, 0);

            exportCanvas.toBlob(async (blob) => {
                try {
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'neologo-drawing.png';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);

                    updateStatus('Exported!');
                    log('Drawing exported as PNG image');

                    const shouldPrint = confirm('Drawing exported! Would you also like to print it?');
                    if (shouldPrint) {
                        printDrawing();
                    }
                } catch (error) {
                    updateStatus('Export failed');
                    log('Export failed: ' + error.message);
                }
            }, 'image/png');

        } catch (error) {
            updateStatus('Export failed');
            log('Export failed: ' + error.message);
        }
    });

    function printDrawing() {
        try {
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
          <html>
            <head>
              <title>NeoLogo Drawing</title>
              <style>
                body { margin: 0; padding: 20px; text-align: center; }
                canvas { border: 1px solid #ccc; max-width: 100%; height: auto; }
                @media print {
                  body { margin: 0; padding: 10px; }
                  canvas { max-width: 100%; height: auto; }
                }
              </style>
            </head>
            <body>
              <h2>NeoLogo Drawing</h2>
              <canvas id="printCanvas" width="${canvas.width}" height="${canvas.height}"></canvas>
              <script>
                const printCanvas = document.getElementById('printCanvas');
                const printCtx = printCanvas.getContext('2d');
                printCtx.fillStyle = 'white';
                printCtx.fillRect(0, 0, printCanvas.width, printCanvas.height);
              </script>
            </body>
          </html>
        `);

            printWindow.document.close();

            printWindow.onload = () => {
                const printCanvas = printWindow.document.getElementById('printCanvas');
                const printCtx = printCanvas.getContext('2d');
                printCtx.drawImage(canvas, 0, 0);

                setTimeout(() => {
                    printWindow.print();
                    printWindow.close();
                }, 500);
            };

            log('Opening print dialog...');
        } catch (error) {
            log('Print failed: ' + error.message);
        }
    }

    document.getElementById('saveBtn').addEventListener('click', () => {
        savedCode = codeArea.value;
        updateStatus('Saved');
        log('Code saved to memory');
    });

    document.getElementById('loadBtn').addEventListener('click', () => {
        if (savedCode) {
            codeArea.value = savedCode;
            updateStatus('Loaded');
            log('Code loaded from memory');
        } else {
            log('No saved code found');
        }
    });

    document.getElementById('shareBtn').addEventListener('click', () => {
        try {
            const code = btoa(encodeURIComponent(codeArea.value));
            const url = window.location.origin + window.location.pathname + '?code=' + code;
            navigator.clipboard.writeText(url).then(() => {
                updateStatus('Link copied!');
                log('Share link copied to clipboard');
            });
        } catch (error) {
            log('Failed to create share link');
        }
    });

    document.getElementById('helpBtn').addEventListener('click', () => {
        document.getElementById('instructions').style.display = 'block';
    });

    document.getElementById('closeInstructions').addEventListener('click', () => {
        document.getElementById('instructions').style.display = 'none';
    });

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            runProgram();
        }
        if (e.key === 'Escape') {
            document.getElementById('instructions').style.display = 'none';
        }
    });

    document.getElementById('instructions').addEventListener('click', (e) => {
        if (e.target.id === 'instructions') {
            document.getElementById('instructions').style.display = 'none';
        }
    });

    // --- Initial Load ---

    const urlParams = new URLSearchParams(window.location.search);
    const sharedCode = urlParams.get('code');
    if (sharedCode) {
        try {
            codeArea.value = decodeURIComponent(atob(sharedCode));
            updateStatus('Shared code loaded');
        } catch (error) {
            log('Failed to load shared code');
        }
    }

    resetTurtle();
    updateStatus('Ready');

    window.addEventListener('resize', updateTurtlePosition);
});
