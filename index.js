#!/usr/bin/env node

const spawn = require("child_process").spawn;
const os = require("os");
const chalk = require("chalk");
const chalkTable = require("chalk-table");
const asciichart = require("asciichart");
const {
    setIntervalAsync,
    clearIntervalAsync
} = require("set-interval-async/dynamic");

const data = {
    cpu: { current: 0, min: 0, max: 0, history: [] },
    temp: { current: 0, min: 0, max: 0, history: [] }
};

const patterns = [
    { name: "name", text: "name" },
    { name: "state", text: "active_task_state" },
    { name: "cpu_remaining", text: "estimated CPU time remaining" },
    { name: "cpu_checkpoint", text: "CPU time at last checkpoint" },
    { name: "cpu_current", text: "current CPU time" },
    { name: "received", text: "received" },
    { name: "deadline", text: "report deadline" }
];

const get_temperature = () => {
    return new Promise((resolve, reject) => {
        let cmd = spawn("/opt/vc/bin/vcgencmd", ["measure_temp"]);
        cmd.stdout.on("data", buf =>
            resolve(buf.toString("utf8").split("=")[1].split("'")[0])
        );
        cmd.stderr.on("data", buf => reject(buf.toString("utf8")));
    });
};

const get_boinc = () => {
    return new Promise((resolve, reject) => {
        let cmd = spawn("boinccmd", ["--get_tasks"]);
        cmd.stdout.on("data", buf => {
            let tasks = buf.toString("utf8").split("-----------");
            let prepared = [];
            for (let i = 1; i < tasks.length; i++) {
                let parsed = {};
                tasks[i].split("\n").forEach(el => {
                    for (let i = 0; i < patterns.length; i++) {
                        if (
                            el.trim().substr(0, patterns[i].text.length) ==
                            patterns[i].text
                        )
                            parsed[patterns[i].name] = el.split(": ")[1];
                    }
                });
                prepared.push(parsed);
            }
            resolve(prepared);
        });
        cmd.stderr.on("data", buf => reject(buf.toString("utf8")));
    });
};

const get_cpu_current = () => {
    let cpus = os.cpus();
    let idle = 0;
    let tick = 0;
    for (let i = 0; i < cpus.length; i++) {
        for (let type in cpus[i].times) {
            tick += cpus[i].times[type];
        }
        idle += cpus[i].times.idle;
    }
    return {
        idle: idle / cpus.length,
        total: tick / cpus.length
    };
};

const get_cpu = () => {
    return new Promise(resolve => {
        let start = get_cpu_current();
        setTimeout(() => {
            let end = get_cpu_current();
            resolve(
                (10000 -
                    Math.round(
                        (10000 * (end.idle - start.idle)) /
                            (end.total - start.total)
                    )) /
                    100
            );
        }, 1000);
    });
};

const draw = table => {
    console.clear();
    console.log(
        "🧬",
        chalk.whiteBright.bold.underline("Raspberry Pi BOINC JS Monitor")
    );
    console.log("");
    console.log(table);
    console.log("");
    console.log(
        "🔥",
        chalk.red(
            `Current: ${data.temp.current} / Max: ${data.temp.max} / Min: ${data.temp.min}`
        )
    );
    console.log("");
    console.log(
        asciichart.plot(data.temp.history, {
            colors: [asciichart.red],
            height: 5
        })
    );
    console.log("");
    console.log(
        "🤖",
        chalk.blue(
            `Current: ${data.cpu.current} / Max: ${data.cpu.max} / Min: ${data.cpu.min}`
        )
    );
    console.log("");
    console.log(
        asciichart.plot(data.cpu.history, {
            colors: [asciichart.blue],
            height: 5
        })
    );
};

const monitor = setIntervalAsync(async () => {
    try {
        data.temp.current = await get_temperature();
        data.cpu.current = await get_cpu();
        let tasks = await get_boinc();
        let lines = [];

        if (data.temp.current > data.temp.max)
            data.temp.max = data.temp.current;
        if (
            data.temp.min == 0 ||
            (data.temp.current < data.temp.min && data.temp.current != 0)
        )
            data.temp.min = data.temp.current;

        if (data.cpu.current > data.cpu.max) data.cpu.max = data.cpu.current;
        if (
            data.cpu.min == 0 ||
            (data.cpu.current < data.cpu.min && data.cpu.current != 0)
        )
            data.cpu.min = data.cpu.current;

        data.temp.history.push(parseFloat(data.temp.current, 10));
        if (data.temp.history.length > 100)
            data.temp.history = data.temp.history.slice(
                data.temp.history.length - 100,
                data.temp.history.length
            );

        data.cpu.history.push(parseFloat(data.cpu.current, 10));
        if (data.cpu.history.length > 100)
            data.cpu.history = data.cpu.history.slice(
                data.cpu.history.length - 100,
                data.cpu.history.length
            );

        for (let i = 0; i < tasks.length; i++) {
            lines.push({
                name: chalk.white(tasks[i].name),
                status:
                    tasks[i].state == "EXECUTING" ||
                    tasks[i].state == "SUSPENDED"
                        ? chalk.greenBright("WORKING")
                        : chalk.redBright(tasks[i].state),
                ready: chalk.blue(
                    tasks[i].cpu_current ? tasks[i].cpu_current : 0
                ),
                remaining: chalk.cyan(tasks[i].cpu_remaining),
                received: chalk.greenBright(
                    tasks[i].received.replace("  ", " ")
                ),
                end: chalk.redBright(tasks[i].deadline.replace("  ", " "))
            });
        }

        draw(
            chalkTable(
                {
                    columns: [
                        { field: "name", name: chalk.whiteBright("Name") },
                        { field: "status", name: chalk.magenta("Status") },
                        { field: "ready", name: chalk.blue("Ready") },
                        { field: "remaining", name: chalk.cyan("Remaining") },
                        { field: "received", name: chalk.green("Received") },
                        { field: "end", name: chalk.red("Deadline") }
                    ]
                },
                lines
            )
        );
    } catch (error) {
        console.log("👾", chalk.redBright.bold(error));
        await clearIntervalAsync(monitor);
    }
}, 1000);
