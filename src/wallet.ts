import { keccak_256 } from '@noble/hashes/sha3';

// Gnosis Safe Factory on Polygon (from Polymarket builder-relayer-client)
const SAFE_FACTORY = '0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b';

// Safe init code hash (from Polymarket builder-relayer-client)
const SAFE_INIT_CODE_HASH =
  '0x2bce2127ff07fb632d16c8347c4ebf501f4841168bed00d9e6ef715ddb6fcecf';

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Derive the Gnosis Safe proxy address for a given EOA via CREATE2.
 *
 * Mirrors the Rust implementation in polymarket-stream `wallet.rs`:
 * - Salt = keccak256(leftPad32(eoa))
 * - Address = keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:]
 */
export function deriveProxyAddress(eoa: string): string {
  const eoaBytes = hexToBytes(eoa);

  // Left-pad EOA to 32 bytes
  const padded = new Uint8Array(32);
  padded.set(eoaBytes, 32 - eoaBytes.length);

  // Salt = keccak256(padded)
  const salt = keccak_256(padded);

  // CREATE2: keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:]
  const factoryBytes = hexToBytes(SAFE_FACTORY);
  const initCodeHashBytes = hexToBytes(SAFE_INIT_CODE_HASH);

  const payload = new Uint8Array(1 + 20 + 32 + 32);
  payload[0] = 0xff;
  payload.set(factoryBytes, 1);
  payload.set(salt, 21);
  payload.set(initCodeHashBytes, 53);

  const hash = keccak_256(payload);
  const address = '0x' + bytesToHex(hash.slice(12));

  return toChecksumAddress(address);
}

/**
 * Normalize an address to lowercase with 0x prefix.
 * Validates format: 0x + 40 hex chars.
 */
export function normalizeAddress(addr: string): string {
  const lower = addr.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(lower)) {
    throw new Error(`Invalid address: ${addr}`);
  }
  return lower;
}

/**
 * EIP-55 checksum encoding.
 */
function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace('0x', '');
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));

  let checksummed = '0x';
  for (let i = 0; i < 40; i++) {
    if (parseInt(hash[i], 16) >= 8) {
      checksummed += lower[i].toUpperCase();
    } else {
      checksummed += lower[i];
    }
  }
  return checksummed;
}
