export type DeviceType = 'auto_injector' | 'nasal_spray' | 'other';

export type Profile = {
  id: string;
  display_name: string;
  phone: string | null;
  carries_epinephrine: boolean;
  device_type: DeviceType | null;
  device_expires_on: string | null; // YYYY-MM-DD
  available_to_respond: boolean;
  allergies: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  share_medical_with_responders: boolean;
  expo_push_token: string | null;
  accepted_terms_version: number | null;
  accepted_terms_at: string | null;
};

export type ProfilePatch = Partial<Omit<Profile, 'id'>>;

export type AlertStatus = 'active' | 'resolved' | 'cancelled';
export type RecipientStatus = 'notified' | 'declined' | 'en_route' | 'arrived' | 'withdrawn';

export type ResponderSummary = {
  user_id: string;
  name: string;
  device_type: DeviceType | null;
  status: RecipientStatus;
  distance_m: number;
  lat: number | null;
  lng: number | null;
  location_at: string | null;
};

export type RequesterAlertView = {
  role: 'requester';
  alert: {
    id: string;
    status: AlertStatus;
    lat: number;
    lng: number;
    note: string | null;
    is_test: boolean;
    radius_m: number;
    notified_count: number;
    created_at: string;
    closed_at: string | null;
  };
  responders: ResponderSummary[];
};

export type ResponderAlertView = {
  role: 'responder';
  my_status: RecipientStatus;
  alert: {
    id: string;
    status: AlertStatus;
    note: string | null;
    is_test: boolean;
    created_at: string;
    closed_at: string | null;
    distance_m: number;
    lat: number | null; // only once you're on the way
    lng: number | null;
  };
  requester: { name: string; allergies: string | null };
  en_route_count: number;
  max_en_route: number;
};

export type AlertView = RequesterAlertView | ResponderAlertView;

export type Invitation = {
  alert_id: string;
  distance_m: number;
  my_status: RecipientStatus;
  is_test: boolean;
  created_at: string;
};

export type MyAlerts = {
  my_active_alert_id: string | null;
  invitations: Invitation[];
};

export type Message = {
  id: number;
  alert_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type Coords = { latitude: number; longitude: number };
