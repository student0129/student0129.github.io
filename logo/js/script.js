'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const turtleEl = document.getElementById('turtle');
    const codeArea = document.getElementById('codeArea');
    const codeDisplay = document.getElementById('codeDisplay');
    const logDiv = document.getElementById('log');
    const statusEl = document.getElementById('status');
    const runBtn = document.getElementById('runBtn');
    const stopBtn = document.getElementById('stopBtn');
    const speedSlider = document.getElementById('speedSlider');
    const speedValue = document.getElementById('speedValue');

    // --- State Variables ---
    let turtle = {};
    let userProcedures = {};
    let variables = {};
    let isRunning = false;
    let shouldStop = false;
    let executionSpeed = 5;

    const colors = {
        red: '#FF0000', blue: '#0000FF', green: '#00FF00', yellow: '#FFFF00',
        orange: '#FFA500', purple: '#800080', pink: '#FFC0CB', brown: '#A52A2A',
        black: '#000000', white: '#FFFFFF', gray: '#808080', cyan: '#00FFFF',
        magenta: '#FF00FF'
    };

    // --- Core Functions ---
    const log = (msg) => {
        logDiv.innerHTML += `> ${msg}<br>`;
        logDiv.scrollTop = logDiv.scrollHeight;
    };

    const updateStatus = (msg) => {
        statusEl.textContent = msg;
    };

    const resetTurtle = () => {
        turtle = {
            x: canvas.width / 2,
            y: canvas.height / 2,
            angle: 0, // 0 degrees is "up"
            pen: true,
            color: '#000000',
            width: 2,
            visible: true,
        };
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        updateTurtleElement();
    };

    const updateTurtleElement = () => {
        const transitionTime = Math.max(50, 400 / executionSpeed);
        turtleEl.style.transition = `all ${transitionTime}ms linear`;
        turtleEl.style.left = `${turtle.x}px`;
        turtleEl.style.top = `${turtle.y}px`;
        turtleEl.style.setProperty('--rotation', `${turtle.angle}deg`);
        turtleEl.style.display = turtle.visible ? 'block' : 'none';
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const parseValue = (token) => {
        if (!token) return 0;
        if (token.startsWith(':')) {
            const varName = token.substring(1);
            if (varName in variables) {
                return variables[varName];
            }
            throw new Error(`Variable :${varName} is not defined.`);
        }
        const num = parseFloat(token);
        return isNaN(num) ? token : num;
    };

    const executeCommand = async (command, args) => {
        if (shouldStop) return;

        const cmd = command.toUpperCase();
        
        switch (cmd) {
            case 'FD': case 'FORWARD': {
                const distance = parseValue(args[0]);
                const rad = (turtle.angle - 90) * Math.PI / 180; // Convert to math angle
                const newX = turtle.x + distance * Math.cos(rad);
                const newY = turtle.y + distance * Math.sin(rad);
                if (turtle.pen) {
                    ctx.beginPath();
                    ctx.moveTo(turtle.x, turtle.y);
                    ctx.lineTo(newX, newY);
                    ctx.strokeStyle = turtle.color;
                    ctx.lineWidth = turtle.width;
                    ctx.stroke();
                }
                turtle.x = newX;
                turtle.y = newY;
                break;
            }
            case 'BK': case 'BACKWARD': {
                const distance = parseValue(args[0]);
                const rad = (turtle.angle - 90) * Math.PI / 180;
                const newX = turtle.x - distance * Math.cos(rad);
                const newY = turtle.y - distance * Math.sin(rad);
                if (turtle.pen) {
                    ctx.beginPath();
                    ctx.moveTo(turtle.x, turtle.y);
                    ctx.lineTo(newX, newY);
                    ctx.strokeStyle = turtle.color;
                    ctx.lineWidth = turtle.width;
                    ctx.stroke();
                }
                turtle.x = newX;
                turtle.y = newY;
                break;
            }
            case 'RT': case 'RIGHT':
                turtle.angle += parseValue(args[0]);
                break;
            case 'LT': case 'LEFT':
                turtle.angle -= parseValue(args[0]);
                break;
            case 'PU': case 'PENUP':
                turtle.pen = false;
                break;
            case 'PD': case 'PENDOWN':
                turtle.pen = true;
                break;
            case 'SETCOLOR': {
                const colorName = parseValue(args[0]).toString().toLowerCase();
                turtle.color = colors[colorName] || colorName;
                break;
            }
            case 'SETWIDTH':
                turtle.width = parseValue(args[0]);
                break;
            case 'CLEAR':
                resetTurtle();
                break;
            case 'HOME':
                turtle.x = canvas.width / 2;
                turtle.y = canvas.height / 2;
                turtle.angle = 0;
                break;
            case 'HT': case 'HIDETURTLE':
                turtle.visible = false;
                break;
            case 'ST': case 'SHOWTURTLE':
                turtle.visible = true;
                break;
            default:
                if (cmd in userProcedures) {
                    await runProcedure(cmd, args);
                } else {
                    throw new Error(`Unknown command: ${command}`);
                }
        }
        updateTurtleElement();
        await sleep(Math.max(50, 400 / executionSpeed));
    };

    const runProgram = async (code) => {
        if (isRunning) return;
        isRunning = true;
        shouldStop = false;
        runBtn.disabled = true;
        stopBtn.disabled = false;
        logDiv.innerHTML = '';
        updateStatus('Running...');

        resetTurtle();
        
        try {
            const { procedures, commands } = parseCode(code);
            userProcedures = procedures;
            variables = {}; // Global scope
            await executeBlock(commands, variables);
            if (!shouldStop) {
                updateStatus('Complete!');
                log('Program finished.');
            }
        } catch (error) {
            log(`Error: ${error.message}`);
            updateStatus('Error');
        } finally {
            isRunning = false;
            runBtn.disabled = false;
            stopBtn.disabled = true;
        }
    };
    
    const stopProgram = () => {
        shouldStop = true;
        updateStatus('Stopping...');
        log('Stop requested by user.');
    };
    
    const parseCode = (code) => {
        const lines = code.split('\n').map(line => line.replace(/#.*/, '').trim()).filter(Boolean);
        const procedures = {};
        const commands = [];
        
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            const tokens = line.split(/\s+/);
            
            if (tokens[0].toUpperCase() === 'TO') {
                const procName = tokens[1].toUpperCase();
                const params = tokens.slice(2).filter(t => t.startsWith(':')).map(t => t.substring(1));
                const body = [];
                i++;
                while (i < lines.length && lines[i].toUpperCase().trim() !== 'END') {
                    body.push(lines[i].trim());
                    i++;
                }
                procedures[procName] = { params, body };
            } else {
                commands.push(line);
            }
            i++;
        }
        return { procedures, commands };
    };

    const executeBlock = async (commandLines, localVariables) => {
        for (const line of commandLines) {
            if (shouldStop) return;
            const tokens = line.split(/\s+/);
            const cmd = tokens[0].toUpperCase();
            
            // Create a new scope for this execution, inheriting from the parent
            const scope = Object.create(localVariables);

            if (cmd === 'MAKE') {
                const varName = tokens[1].replace(/"/g, '');
                const value = parseValue(tokens[2]);
                localVariables[varName] = value;
            } else if (cmd === 'REPEAT') {
                const count = parseValue(tokens[1]);
                const blockStartIndex = line.indexOf('[');
                const blockEndIndex = line.lastIndexOf(']');
                const blockCode = line.substring(blockStartIndex + 1, blockEndIndex).trim();
                for (let i = 0; i < count; i++) {
                    if (shouldStop) return;
                    await executeBlock([blockCode], scope);
                }
            } else {
                 if (cmd in userProcedures) {
                    await runProcedure(cmd, tokens.slice(1), scope);
                } else {
                    await executeCommand(cmd, tokens.slice(1));
                }
            }
        }
    };

    async function runProcedure(procName, args, callingScope) {
        const proc = userProcedures[procName];
        if (!proc) throw new Error(`Procedure ${procName} not found.`);

        // Create a new, isolated scope for the procedure
        const procedureScope = {}; 
        
        // Assign arguments to parameters in the new scope
        proc.params.forEach((paramName, index) => {
            const argValue = parseValue(args[index]);
            procedureScope[paramName] = argValue;
        });
        
        // Set the prototype to the calling scope to allow reading global variables
        Object.setPrototypeOf(procedureScope, callingScope);
        
        await executeBlock(proc.body, procedureScope);
    }

    // --- Event Listeners ---
    runBtn.addEventListener('click', () => runProgram(codeArea.value));
    stopBtn.addEventListener('click', stopProgram);

    document.getElementById('clearBtn').addEventListener('click', () => {
        resetTurtle();
        log('Canvas cleared.');
        updateStatus('Ready');
    });

    speedSlider.addEventListener('input', (e) => {
        executionSpeed = parseInt(e.target.value, 10);
        speedValue.textContent = executionSpeed;
    });

    // --- Initial Setup ---
    resetTurtle();
    updateStatus('Ready');
});
