import CryptoJS from 'crypto-js';

/**
 * Deriva uma chave de criptografia a partir de uma senha ou segredo da sala.
 */
export const deriveKey = (secret: string) => {
  return CryptoJS.SHA256(secret).toString();
};

/**
 * Criptografa dados (texto ou base64) usando AES.
 */
export const encryptData = (data: string, key: string) => {
  return CryptoJS.AES.encrypt(data, key).toString();
};

/**
 * Descriptografa dados usando AES.
 */
export const decryptData = (ciphertext: string, key: string) => {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    console.error("Erro ao descriptografar:", e);
    return "[Erro de Criptografia]";
  }
};

/**
 * Gera um hash para verificação de senha (não usado para criptografia direta).
 */
export const hashPassword = (password: string) => {
  return CryptoJS.SHA256(password).toString();
};
