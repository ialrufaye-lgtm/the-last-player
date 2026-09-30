"use strict";
/** 4-char room codes (A-Z0-9, unambiguous chars only). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCode = generateCode;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(used) {
    let code = '';
    do {
        code = '';
        for (let i = 0; i < 4; i++) {
            code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
        }
    } while (used.has(code));
    used.add(code);
    return code;
}
