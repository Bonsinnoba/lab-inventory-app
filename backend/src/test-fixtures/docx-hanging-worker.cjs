// Fault injection: emulate a synchronous parser that never returns.
process.once('message', () => { while (true) {} });
