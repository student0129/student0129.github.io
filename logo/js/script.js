document.addEventListener('DOMContentLoaded', () => {
    // Simple Logo interpreter - no external dependencies
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const turtleEl = document.getElementById('turtle');
    const codeArea = document.getElementById('codeArea');
    const logDiv = document.getElementById('log');
    const statusEl = document.getElementById('status');

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
    let codeLines = [];

    const colors = {
        red: '#FF0000', blue: '#0000FF', green: '#00FF00', yellow: '#FFFF00',
        orange: '#FFA500', purple: '#800080', pink: '#FFC0CB', brown: '#A52A2A',
        black: '#000000', white: '#FFFFFF', gray: '#808080', cyan: '#00FFFF',
        magenta: '#FF00FF'
    };

    function updateStatus(msg) { statusEl.textContent = msg; }
    function log(msg) { logDiv.innerHTML += msg + '<br>'; logDiv.scrollTop = logDiv.scrollHeight; }
    function clearLog() { logDiv.innerHTML = ''; }
    
    function resetTurtle() {
        turtle.x = canvas.width / 2;
        turtle.y = canvas.height / 2;
        turtle.angle = 90;
        turtle.pen = true;
        turtle.color = '#000000';
        turtle.width = 2;
        turtle.visible = true;
        updateTurtlePosition();
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

    function highlightCurrentLine(lineNumber) {
        document.querySelectorAll('.highlight-line').forEach(el => el.classList.remove('highlight-line'));
        if (lineNumber >= 0 && lineNumber < codeLines.length) {
            const lineElements = document.querySelectorAll('#codeDisplay .code-line');
            if (lineElements[lineNumber]) {
                lineElements[lineNumber].classList.add('highlight-line');
            }
        }
    }

    function updateCodeDisplay() {
        codeLines = codeArea.value.split('\n');
        const codeDisplay = document.getElementById('codeDisplay');
        codeDisplay.innerHTML = codeLines.map((line, index) => `<div class="code-line" data-line="${index}">${line || ' '}</div>`).join('');
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
            setTimeout(resolve, Math.max(50, 1000 / executionSpeed));
        });
    }

    function turn(angle) {
        return new Promise(resolve => {
            turtle.angle = (turtle.angle + angle) % 360;
            updateTurtlePosition();
            setTimeout(resolve, Math.max(25, 500 / executionSpeed));
        });
    }

    async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    function tokenize(code) {
        const lines = code.split('\n');
        const tokenizedLines = [];
        lines.forEach((line, lineIndex) => {
            const cleanLine = line.replace(/#[^\n]*/g, '').trim();
            if (cleanLine) {
                // This regex handles brackets as separate tokens
                const tokens = cleanLine.match(/\[|\]|[^[\]\s]+/g) || [];
                tokens.forEach(token => tokenizedLines.push({ token, lineNumber: lineIndex }));
            }
        });
        return tokenizedLines;
    }

    function parseValue(token) {
        if (!token) return 0;
        if (token.startsWith(':')) { return variables[token.substring(1)] || 0; }
        const num = parseFloat(token);
        return isNaN(num) ? token : num;
    }
    
    // New helper to evaluate simple expressions like ":n - 3"
    function evaluateExpression(tokens, index) {
        const val1Token = tokens[index];
        const opToken = tokens[index + 1];
        const val2Token = tokens[index + 2];

        if (opToken && ['+', '-', '*', '/'].includes(opToken.token)) {
            const val1 = parseValue(val1Token.token);
            const val2 = parseValue(val2Token.token);
            let result;
            switch (opToken.token) {
                case '+': result = val1 + val2; break;
                case '-': result = val1 - val2; break;
                case '*': result = val1 * val2; break;
                case '/': result = val1 / val2; break;
            }
            return { value: result, consumed: 3 };
        }
        return { value: parseValue(val1Token.token), consumed: 1 };
    }

    // New helper for evaluating conditions like ":n > 5"
    function evaluateCondition(tokens, index) {
        const val1Token = tokens[index];
        const opToken = tokens[index + 1];
        const val2Token = tokens[index + 2];

        if (opToken && ['>', '<', '=', '==', '>=', '<='].includes(opToken.token)) {
            const val1 = parseValue(val1Token.token);
            const val2 = parseValue(val2Token.token);
            let result;
            switch (opToken.token) {
                case '>': result = val1 > val2; break;
                case '<': result = val1 < val2; break;
                case '=': case '==': result = val1 == val2; break;
                case '>=': result = val1 >= val2; break;
                case '<=': result = val1 <= val2; break;
            }
            return { value: result, consumed: 3 };
        }
        return { value: !!parseValue(val1Token.token), consumed: 1 };
    }

    async function executeTokens(tokens, isProcedure = false) {
        let i = 0;
        while (i < tokens.length && !shouldStop) {
            const tokenObj = tokens[i];
            const command = tokenObj.token.toUpperCase();
            const lineNumber = tokenObj.lineNumber;

            if (lineNumber !== -1) {
                highlightCurrentLine(lineNumber);
                await sleep(Math.max(50, 100 / executionSpeed));
            }

            if (command === 'TO' && !isProcedure) {
                const name = tokens[i + 1].token.toUpperCase();
                let params = [];
                let bodyStartIndex = i + 2;
                while(tokens[bodyStartIndex] && tokens[bodyStartIndex].token.startsWith(':')) {
                    params.push(tokens[bodyStartIndex].token.substring(1));
                    bodyStartIndex++;
                }
                
                const body = [];
                let endTokenIndex = -1;
                for (let j = bodyStartIndex; j < tokens.length; j++) {
                    if (tokens[j].token.toUpperCase() === 'END') {
                        endTokenIndex = j;
                        break;
                    }
                    body.push(tokens[j]);
                }
                userProcedures[name] = { params, body };
                i = endTokenIndex + 1;
                continue;
            }
            
            if (command === 'END' && !isProcedure) { i++; continue; }

            if (command === 'REPEAT') {
                const countResult = evaluateExpression(tokens, i + 1);
                const count = Math.floor(countResult.value);
                let blockStartIndex = i + 1 + countResult.consumed;
                if (tokens[blockStartIndex].token !== '[') throw new Error('Expected [ after REPEAT count');
                
                const body = [];
                let depth = 1;
                let blockEndIndex = -1;
                for (let j = blockStartIndex + 1; j < tokens.length; j++) {
                    if (tokens[j].token === '[') depth++;
                    if (tokens[j].token === ']') depth--;
                    if (depth === 0) {
                        blockEndIndex = j;
                        break;
                    }
                    body.push(tokens[j]);
                }
                
                for (let j = 0; j < count && !shouldStop; j++) {
                    await executeTokens(body, true);
                }
                i = blockEndIndex + 1;
                continue;
            }

            if (command === 'IF') {
                const condition = evaluateCondition(tokens, i + 1);
                let blockStartIndex = i + 1 + condition.consumed;
                 if (tokens[blockStartIndex].token !== '[') throw new Error('Expected [ after IF condition');

                const body = [];
                let depth = 1;
                let blockEndIndex = -1;
                for (let j = blockStartIndex + 1; j < tokens.length; j++) {
                    if (tokens[j].token === '[') depth++;
                    if (tokens[j].token === ']') depth--;
                    if (depth === 0) {
                        blockEndIndex = j;
                        break;
                    }
                    body.push(tokens[j]);
                }

                if (condition.value) {
                    await executeTokens(body, true);
                }
                i = blockEndIndex + 1;
                continue;
            }

            if (command === 'MAKE') {
                const varName = tokens[i + 1].token.replace(/"/g, '');
                const valueResult = evaluateExpression(tokens, i + 2);
                variables[varName] = valueResult.value;
                i += 2 + valueResult.consumed;
                continue;
            }

            if (userProcedures[command]) {
                const proc = userProcedures[command];
                const oldVars = { ...variables }; // Save state
                
                // Bind parameters
                let argIndex = i + 1;
                for(const param of proc.params) {
                    const arg = evaluateExpression(tokens, argIndex);
                    variables[param] = arg.value;
                    argIndex += arg.consumed;
                }

                await executeTokens(proc.body, true);
                variables = oldVars; // Restore state
                i = argIndex;
                continue;
            }

            // Handle primitive commands
            let argValue;
            let consumed = 1;
            const argCommands = new Set(['FD', 'FORWARD', 'BK', 'BACKWARD', 'RT', 'RIGHT', 'LT', 'LEFT', 'SETCOLOR', 'SETWIDTH', 'SHOW', 'PRINT']);
            if (argCommands.has(command)) {
                const argResult = evaluateExpression(tokens, i + 1);
                argValue = argResult.value;
                consumed += argResult.consumed;
            }
            
            switch (command) {
                case 'FD': case 'FORWARD': await forward(argValue); break;
                case 'BK': case 'BACKWARD': await forward(-argValue); break;
                case 'RT': case 'RIGHT': await turn(argValue); break;
                case 'LT': case 'LEFT': await turn(-argValue); break;
                case 'PU': case 'PENUP': turtle.pen = false; break;
                case 'PD': case 'PENDOWN': turtle.pen = true; break;
                case 'SETCOLOR': turtle.color = colors[argValue.toString().toLowerCase()] || argValue; break;
                case 'SETWIDTH': turtle.width = argValue; break;
                case 'CLEAR': resetTurtle(); break;
                case 'HOME': turtle.x = canvas.width / 2; turtle.y = canvas.height / 2; turtle.angle = 90; updateTurtlePosition(); break;
                case 'SHOW': case 'PRINT': log('Output: ' + argValue); break;
                case 'HT': case 'HIDETURTLE': turtle.visible = false; updateTurtlePosition(); break;
                case 'ST': case 'SHOWTURTLE': turtle.visible = true; updateTurtlePosition(); break;
                default: throw new Error(`Unknown command: ${command}`);
            }
            i += consumed;
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
            console.error(error);
        } finally {
            isRunning = false;
            shouldStop = false;
            highlightCurrentLine(-1);
            document.getElementById('runBtn').disabled = false;
            document.getElementById('stopBtn').disabled = true;
            updateCodeDisplay();
        }
    }

    function stopProgram() { shouldStop = true; updateStatus('Stopping...'); }

    // --- Event Listeners ---
    document.getElementById('runBtn').addEventListener('click', runProgram);
    document.getElementById('stopBtn').addEventListener('click', stopProgram);
    document.getElementById('clearBtn').addEventListener('click', () => { resetTurtle(); updateStatus('Canvas cleared'); log('Canvas cleared'); });
    const speedSlider = document.getElementById('speedSlider');
    const speedValue = document.getElementById('speedValue');
    speedSlider.addEventListener('input', (e) => { executionSpeed = parseInt(e.target.value); speedValue.textContent = executionSpeed; });
    document.getElementById('toggleTurtleBtn').addEventListener('click', () => {
        turtle.visible = !turtle.visible;
        updateTurtlePosition();
        const btn = document.getElementById('toggleTurtleBtn');
        btn.textContent = turtle.visible ? '👁️ Hide Turtle' : '👁️ Show Turtle';
        log(turtle.visible ? 'Turtle is now visible' : 'Turtle is now hidden');
    });
    document.getElementById('helpBtn').addEventListener('click', () => { document.getElementById('instructions').style.display = 'block'; });
    document.getElementById('closeInstructions').addEventListener('click', () => { document.getElementById('instructions').style.display = 'none'; });
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); runProgram(); }
        if (e.key === 'Escape') { document.getElementById('instructions').style.display = 'none'; }
    });
    document.getElementById('instructions').addEventListener('click', (e) => { if (e.target.id === 'instructions') { document.getElementById('instructions').style.display = 'none'; } });

    // --- Initial Load ---
    resetTurtle();
    updateStatus('Ready');
    window.addEventListener('resize', updateTurtlePosition);
});
