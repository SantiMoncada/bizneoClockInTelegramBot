
export interface UserData {
  userId: number,
  geo: {
    lat: number,
    long: number,
    accuracy: number
  };
  cookies: {
    geo: string;
    hcmex: string;
    deviceId: string;
    domain: string;
    expires: number;
  }
  fakeGeo: number | null
}
