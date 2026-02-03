export interface UserData {
  userId: number,
  geo: {
    lat: number,
    long: number,
    accuracy: number
  };
  timeZone?: string;
  cookies: {
    geo: string;
    hcmex: string;
    deviceId: string;
    domain: string;
    expires: number;
  }
}
