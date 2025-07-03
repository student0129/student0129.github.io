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
        logDiv.innerHTML += `${msg}<br>`;
        logDiv.scrollTop = logDiv.scrollHeight;
    };

    const updateStatus = (msg) => {
        statusEl.textContent = msg;
    };

    const resetTurtle = () => {
        turtle = {
            x: canvas.width / 2,
            y: canvas.height / 2,
            angle: 0,
            pen: true,
            color: '#000000',
            width: 2,
            visible: true,
        };
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        updateTurtleElement();
    };

    const updateTurtleElement = () => {
        turtleEl.style.left = `${turtle.x}px`;
        turtleEl.style.top = `${turtle.y}px`;
        turtleEl.style.setProperty('--rotation', `${turtle.angle - 90}deg`);
        turtleEl.style.display = turtle.visible ? 'block' : 'none';
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // --- Execution Logic ---
    const executeCommand = async (command, args) => {
        if (shouldStop) return;

        const value = (token) => {
            if (!token) return 0;
            if (token.startsWith(':')) return variables[token.substring(1)] || 0;
            const num = parseFloat(token);
            return isNaN(num) ? token : num;
        };

        const arg1 = value(args[0]);
        const cmd = command.toUpperCase();

        switch (cmd) {
            case 'FD': case 'FORWARD':
                const rad = (turtle.angle - 90) * Math.PI / 180;
                const newX = turtle.x + arg1 * Math.cos(rad);
                const newY = turtle.y + arg1 * Math.sin(rad);
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
            // ... (Additional commands would be added here)
        }
        updateTurtleElement();
        await sleep(Math.max(50, 400 / executionSpeed));
    };

    const runProgram = async () => {
        if (isRunning) return;
        isRunning = true;
        shouldStop = false;
        runBtn.disabled = true;
        stopBtn.disabled = false;
        logDiv.innerHTML = '';
        updateStatus('Running...');
        
        resetTurtle();
        userProcedures = {};
        variables = {};
        
        const code = codeArea.value;
        const lines = code.split('\n');

        try {
            for (const line of lines) {
                if (shouldStop) break;
                const tokens = line.replace(/#.*/, '').trim().split(/\s+/).filter(Boolean);
                if (tokens.length > 0) {
                    const [command, ...args] = tokens;
                    await executeCommand(command, args);
                }
            }
            if (!shouldStop) updateStatus('Complete!');
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
    };

    // --- Event Listeners ---
    runBtn.addEventListener('click', runProgram);
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

    // --- Initial Setup ---
    resetTurtle();
    updateStatus('Ready');
});
