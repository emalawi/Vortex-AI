export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  customGeminiApiKey?: string;
  createdAt: string;
}

export interface Chat {
  id: string;
  userId: string;
  title: string;
  createdAt: any; // Firestore Timestamp
  updatedAt: any;
}

export interface Attachment {
  name: string;
  type: string;
  data: string; // base64
}

export interface Message {
  id: string;
  chatId: string;
  userId: string;
  role: 'user' | 'model';
  content: string;
  attachments?: Attachment[];
  createdAt: any;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}
