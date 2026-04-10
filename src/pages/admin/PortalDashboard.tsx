/**
 * Portal Dashboard - Analytics and Management Interface
 *
 * Provides overview of patient portal adoption and usage:
 * - Total patients with portal access
 * - Verification and activity statistics
 * - Filtered patient list with portal status
 * - Quick actions for bulk operations
 */

import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  UserGroupIcon,
  CheckCircleIcon,
  ClockIcon,
  ChartBarIcon,
  CogIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { db, type Patient } from "@/db";
import { formatNigerianDate } from "@/utils/dateFormat";

interface PortalStats {
  totalPatients: number;
  portalEnabled: number;
  verified: number;
  active30Days: number;
  invitationsSent: number;
  pendingVerification: number;
}

interface PatientWithPortalStatus extends Patient {
  portalStatusLabel: string;
  portalStatusColor: string;
}

export function PortalDashboard() {
  const [stats, setStats] = useState<PortalStats>({
    totalPatients: 0,
    portalEnabled: 0,
    verified: 0,
    active30Days: 0,
    invitationsSent: 0,
    pendingVerification: 0,
  });
  const [patients, setPatients] = useState<PatientWithPortalStatus[]>([]);
  const [filteredPatients, setFilteredPatients] = useState<
    PatientWithPortalStatus[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "enabled" | "disabled" | "verified" | "pending"
  >("all");

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    filterPatients();
  }, [searchQuery, statusFilter, patients]);

  const loadData = async () => {
    setLoading(true);
    try {
      const allPatients = await db.patients.toArray();

      // Calculate statistics
      const totalPatients = allPatients.length;
      const portalEnabled = allPatients.filter(
        (p) => p.portalEnabled === 1,
      ).length;
      const verified = allPatients.filter(
        (p) => p.contactVerified === 1,
      ).length;

      // Active in last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const active30Days = allPatients.filter((p) => {
        if (!p.lastPortalActivity) return false;
        return new Date(p.lastPortalActivity) > thirtyDaysAgo;
      }).length;

      // Count invitations sent
      const invitationsSent = allPatients.filter(
        (p) =>
          p.portalInvitation &&
          p.portalInvitation.count &&
          p.portalInvitation.count > 0,
      ).length;

      // Pending verification
      const pendingVerification = allPatients.filter(
        (p) => p.portalEnabled === 1 && p.contactVerified === 0,
      ).length;

      setStats({
        totalPatients,
        portalEnabled,
        verified,
        active30Days,
        invitationsSent,
        pendingVerification,
      });

      // Map patients with status labels
      const patientsWithStatus: PatientWithPortalStatus[] = allPatients.map(
        (p) => {
          let statusLabel = "Not Enabled";
          let statusColor = "gray";

          if (p.portalEnabled === 1) {
            if (p.contactVerified === 1) {
              statusLabel = "Verified";
              statusColor = "green";
            } else {
              statusLabel = "Pending Verification";
              statusColor = "yellow";
            }
          }

          return {
            ...p,
            portalStatusLabel: statusLabel,
            portalStatusColor: statusColor,
          };
        },
      );

      setPatients(patientsWithStatus);
    } catch (error) {
      console.error("Error loading portal dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const filterPatients = () => {
    let filtered = patients;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.givenName.toLowerCase().includes(query) ||
          p.familyName.toLowerCase().includes(query) ||
          p.email?.toLowerCase().includes(query) ||
          p.phone?.includes(query),
      );
    }

    // Apply status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((p) => {
        switch (statusFilter) {
          case "enabled":
            return p.portalEnabled === 1;
          case "disabled":
            return p.portalEnabled === 0;
          case "verified":
            return p.contactVerified === 1;
          case "pending":
            return p.portalEnabled === 1 && p.contactVerified === 0;
          default:
            return true;
        }
      });
    }

    setFilteredPatients(filtered);
  };

  const getStatusBadge = (patient: PatientWithPortalStatus) => {
    const colorClasses = {
      green: "bg-green-100 text-green-800",
      yellow: "bg-yellow-100 text-yellow-800",
      gray: "bg-gray-100 text-gray-800",
    };

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClasses[patient.portalStatusColor as keyof typeof colorClasses]}`}
      >
        {patient.portalStatusLabel}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading portal dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Patient Portal Dashboard
          </h1>
          <p className="text-gray-600">
            Monitor portal adoption and patient engagement
          </p>
        </div>
        <Link
          to="/admin/portal-migration"
          className="btn-primary inline-flex items-center space-x-2"
        >
          <CogIcon className="h-5 w-5" />
          <span>Bulk Migration</span>
        </Link>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="card bg-blue-50 border-blue-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-blue-600">Total Patients</p>
            <UserGroupIcon className="h-6 w-6 text-blue-600" />
          </div>
          <p className="text-3xl font-bold text-blue-900">
            {stats.totalPatients}
          </p>
          <p className="text-xs text-blue-800 mt-1">In the system</p>
        </div>

        <div className="card bg-green-50 border-green-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-green-600">Portal Enabled</p>
            <CheckCircleIcon className="h-6 w-6 text-green-600" />
          </div>
          <p className="text-3xl font-bold text-green-900">
            {stats.portalEnabled}
          </p>
          <p className="text-xs text-green-800 mt-1">
            {stats.totalPatients > 0
              ? `${Math.round((stats.portalEnabled / stats.totalPatients) * 100)}% adoption`
              : "0% adoption"}
          </p>
        </div>

        <div className="card bg-purple-50 border-purple-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-purple-600">
              Verified Users
            </p>
            <CheckCircleIcon className="h-6 w-6 text-purple-600" />
          </div>
          <p className="text-3xl font-bold text-purple-900">{stats.verified}</p>
          <p className="text-xs text-purple-800 mt-1">
            {stats.portalEnabled > 0
              ? `${Math.round((stats.verified / stats.portalEnabled) * 100)}% verified`
              : "0% verified"}
          </p>
        </div>

        <div className="card bg-yellow-50 border-yellow-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-yellow-600">
              Pending Verification
            </p>
            <ClockIcon className="h-6 w-6 text-yellow-600" />
          </div>
          <p className="text-3xl font-bold text-yellow-900">
            {stats.pendingVerification}
          </p>
          <p className="text-xs text-yellow-800 mt-1">Awaiting first login</p>
        </div>

        <div className="card bg-indigo-50 border-indigo-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-indigo-600">
              Active (30 days)
            </p>
            <ChartBarIcon className="h-6 w-6 text-indigo-600" />
          </div>
          <p className="text-3xl font-bold text-indigo-900">
            {stats.active30Days}
          </p>
          <p className="text-xs text-indigo-800 mt-1">
            {stats.verified > 0
              ? `${Math.round((stats.active30Days / stats.verified) * 100)}% active`
              : "0% active"}
          </p>
        </div>

        <div className="card bg-teal-50 border-teal-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-teal-600">
              Invitations Sent
            </p>
            <UserGroupIcon className="h-6 w-6 text-teal-600" />
          </div>
          <p className="text-3xl font-bold text-teal-900">
            {stats.invitationsSent}
          </p>
          <p className="text-xs text-teal-800 mt-1">Total sent</p>
        </div>
      </div>

      {/* Patient List */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Patients ({filteredPatients.length})
          </h2>
          <div className="flex items-center space-x-4">
            <div className="relative">
              <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search patients..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="input-field"
            >
              <option value="all">All Status</option>
              <option value="enabled">Portal Enabled</option>
              <option value="disabled">Portal Disabled</option>
              <option value="verified">Verified</option>
              <option value="pending">Pending Verification</option>
            </select>
          </div>
        </div>

        {filteredPatients.length === 0 ? (
          <div className="text-center py-12">
            <UserGroupIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600">No patients found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Contact
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Portal Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Last Activity
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Invitations
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPatients.slice(0, 50).map((patient) => (
                  <tr key={patient.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/patients/${patient.id}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {patient.givenName} {patient.familyName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">
                        {patient.phone && (
                          <div className="text-gray-900">{patient.phone}</div>
                        )}
                        {patient.email && (
                          <div className="text-gray-600">{patient.email}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">{getStatusBadge(patient)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {patient.lastPortalActivity
                        ? formatNigerianDate(
                            new Date(patient.lastPortalActivity),
                          )
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {patient.portalInvitation?.count || 0}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/patients/${patient.id}`}
                        className="text-primary hover:underline text-sm font-medium"
                      >
                        View Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredPatients.length > 50 && (
              <div className="mt-4 text-center text-sm text-gray-600">
                Showing 50 of {filteredPatients.length} patients
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
