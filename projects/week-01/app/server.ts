import { buildApp } from './api.ts';

const address = await buildApp().listen({ host: '127.0.0.1', port: 3000 });
console.log(`Listening at ${address}`);
