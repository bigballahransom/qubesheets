declare global {
  interface Window {
    Intercom: (action: string, ...params: any[]) => void;
    intercomSettings?: {
      app_id: string;
      user_id?: string;
      name?: string;
      email?: string;
      created_at?: number;
      [key: string]: any;
    };
  }
}

export {};