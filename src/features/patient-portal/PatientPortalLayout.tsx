import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  HomeIcon,
  CalendarIcon,
  ClipboardDocumentListIcon,
  EnvelopeIcon,
  BeakerIcon,
  UserCircleIcon,
  ArrowLeftOnRectangleIcon,
  Bars3Icon,
  XMarkIcon,
  ChevronDownIcon,
  UserGroupIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useState, useEffect } from "react";
import { EmergencyHelp } from "./EmergencyHelp";
import type { ManagedPatient } from "@/services/patientPortalAuth";
import { supabase } from "@/lib/supabase";
import { getPatientProfile } from "@/services/patientService";

interface PatientPortalLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { path: "/patient/dashboard", label: "Dashboard", icon: HomeIcon },
  { path: "/patient/appointments", label: "Appointments", icon: CalendarIcon },
  {
    path: "/patient/medical-history",
    label: "Medical History",
    icon: ClipboardDocumentListIcon,
  },
  { path: "/patient/messages", label: "Messages", icon: EnvelopeIcon },
  { path: "/patient/lab-results", label: "Lab Results", icon: BeakerIcon },
  { path: "/patient/account", label: "Account", icon: UserCircleIcon },
];

function getPortalUserInfo() {
  const str = localStorage.getItem("patient_portal_user");
  if (!str)
    return {
      name: "Patient",
      managedPatients: [] as ManagedPatient[],
      portalUserId: "",
      ownPatientId: "",
    };
  const u = JSON.parse(str);
  return {
    name: u.givenName || "Patient",
    managedPatients: (u.managedPatients || []) as ManagedPatient[],
    portalUserId: u.id || "",
    ownPatientId: u.patientId || "",
  };
}

function getActiveProfile() {
  const str = localStorage.getItem("patient_active_profile");
  return str ? JSON.parse(str) : null;
}

export function PatientPortalLayout({ children }: PatientPortalLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);

  // Populate patient_portal_user in localStorage for Supabase-auth sessions
  // (Supabase login doesn't set it, but MedicalHistory/Messages need it)
  useEffect(() => {
    const existing = localStorage.getItem("patient_portal_user");
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        if (parsed.patientId && parsed.id) return;
      } catch {
        // fall through to fetch
      }
    }
    if (!supabase) return;
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const result = await getPatientProfile(user.id);
      if (!result.data) return;
      const entry = {
        id: user.id,
        patientId: result.data.id,
        givenName: result.data.givenName,
        familyName: result.data.familyName,
        email: user.email ?? result.data.email ?? "",
        managedPatients: [],
      };
      localStorage.setItem("patient_portal_user", JSON.stringify(entry));
    });
  }, []);

  const { name, managedPatients } = getPortalUserInfo();
  const activeProfile = getActiveProfile();
  const displayName = activeProfile?.givenName || name;

  const handleLogout = () => {
    localStorage.removeItem("patient_session_token");
    localStorage.removeItem("patient_portal_user");
    localStorage.removeItem("patient_active_profile");
    navigate("/patient");
  };

  const switchProfile = (
    patientId: string,
    givenName: string,
    familyName: string,
  ) => {
    localStorage.setItem(
      "patient_active_profile",
      JSON.stringify({ patientId, givenName, familyName }),
    );
    setProfileMenuOpen(false);
    window.location.reload();
  };

  const switchToSelf = () => {
    localStorage.removeItem("patient_active_profile");
    setProfileMenuOpen(false);
    window.location.reload();
  };

  const hasManagedPatients = managedPatients.length > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link to="/patient/dashboard" className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">mB</span>
                </div>
                <span className="font-semibold text-gray-900 hidden sm:block">
                  Patient Portal
                </span>
              </Link>
            </div>

            <nav className="hidden md:flex items-center gap-1">
              {navItems.slice(0, 4).map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              {/* Profile / caregiver switcher */}
              <div className="relative hidden sm:block">
                <button
                  onClick={() =>
                    hasManagedPatients && setProfileMenuOpen(!profileMenuOpen)
                  }
                  className={`flex items-center gap-2 text-sm text-gray-700 px-3 py-2 rounded-lg transition-colors ${
                    hasManagedPatients
                      ? "hover:bg-gray-100 cursor-pointer"
                      : "cursor-default"
                  }`}
                >
                  <UserCircleIcon className="w-5 h-5" />
                  <span className="max-w-[120px] truncate">{displayName}</span>
                  {hasManagedPatients && (
                    <ChevronDownIcon className="w-4 h-4" />
                  )}
                </button>

                {profileMenuOpen && hasManagedPatients && (
                  <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg py-2 z-50">
                    <button
                      onClick={switchToSelf}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                        !activeProfile
                          ? "font-semibold text-blue-700"
                          : "text-gray-700"
                      }`}
                    >
                      <UserCircleIcon className="w-4 h-4" />
                      Yourself – {name}
                    </button>
                    {managedPatients.map((mp) => (
                      <button
                        key={mp.patientId}
                        onClick={() =>
                          switchProfile(
                            mp.patientId,
                            mp.givenName,
                            mp.familyName,
                          )
                        }
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                          activeProfile?.patientId === mp.patientId
                            ? "font-semibold text-blue-700"
                            : "text-gray-700"
                        }`}
                      >
                        <UserGroupIcon className="w-4 h-4" />
                        {mp.givenName} {mp.familyName}
                        <span className="ml-auto text-xs text-gray-400">
                          {mp.relationship}
                        </span>
                      </button>
                    ))}
                    <div className="border-t border-gray-100 mt-1 pt-1">
                      <Link
                        to="/patient/caregiver/add"
                        onClick={() => setProfileMenuOpen(false)}
                        className="w-full text-left px-4 py-2.5 text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2"
                      >
                        <span className="text-lg leading-none">+</span>
                        Add a patient I care for
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              {/* Emergency button — desktop */}
              <button
                onClick={() => setEmergencyOpen(true)}
                className="hidden md:flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
                aria-label="Emergency help"
              >
                <ExclamationTriangleIcon className="w-4 h-4" />
                Emergency
              </button>

              <button
                onClick={handleLogout}
                className="hidden md:flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <ArrowLeftOnRectangleIcon className="w-5 h-5" />
                <span>Logout</span>
              </button>

              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                {mobileMenuOpen ? (
                  <XMarkIcon className="w-6 h-6" />
                ) : (
                  <Bars3Icon className="w-6 h-6" />
                )}
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 bg-white">
            <nav className="px-4 py-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
              {hasManagedPatients && (
                <>
                  <hr className="my-1" />
                  <p className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Switch Profile
                  </p>
                  <button
                    onClick={() => {
                      switchToSelf();
                      setMobileMenuOpen(false);
                    }}
                    className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-700 hover:bg-gray-100 w-full text-left"
                  >
                    <UserCircleIcon className="w-5 h-5" />
                    Yourself – {name}
                  </button>
                  {managedPatients.map((mp) => (
                    <button
                      key={mp.patientId}
                      onClick={() => {
                        switchProfile(
                          mp.patientId,
                          mp.givenName,
                          mp.familyName,
                        );
                        setMobileMenuOpen(false);
                      }}
                      className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-700 hover:bg-gray-100 w-full text-left"
                    >
                      <UserGroupIcon className="w-5 h-5" />
                      {mp.givenName} {mp.familyName}
                    </button>
                  ))}
                </>
              )}
              <hr className="my-2" />
              <Link
                to="/patient/caregiver/add"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-blue-600 hover:bg-blue-50 w-full"
              >
                <UserGroupIcon className="w-5 h-5" />
                Add patient I care for
              </Link>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setEmergencyOpen(true);
                }}
                className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 w-full transition-colors"
              >
                <ExclamationTriangleIcon className="w-5 h-5" />
                Emergency Help
              </button>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleLogout();
                }}
                className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 w-full transition-colors"
              >
                <ArrowLeftOnRectangleIcon className="w-5 h-5" />
                <span>Logout</span>
              </button>
            </nav>
          </div>
        )}
      </header>

      <main className="pb-20 md:pb-8">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40">
        <div className="flex justify-around py-2">
          {navItems.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg ${
                  isActive ? "text-blue-600" : "text-gray-500"
                }`}
              >
                <Icon className="w-6 h-6" />
                <span className="text-xs">{item.label.split(" ")[0]}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Mobile emergency FAB */}
      <button
        onClick={() => setEmergencyOpen(true)}
        className="md:hidden fixed bottom-20 right-4 z-50 w-14 h-14 bg-red-600 hover:bg-red-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
        aria-label="Emergency help"
      >
        <ExclamationTriangleIcon className="w-7 h-7" />
      </button>

      {/* Emergency modal */}
      {emergencyOpen && (
        <EmergencyHelp onClose={() => setEmergencyOpen(false)} />
      )}
    </div>
  );
}
