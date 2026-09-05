using System.Security.Claims;
using UniDipVeri.Application.Abstractions.Models;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Abstractions.Services;

public interface IAuthService
{
    Task<AuthResult> AuthenticateStaffAsync(string email, string password, CancellationToken ct = default);
    Task<AuthResult> AuthenticateStudentAsync(string email, string password, CancellationToken ct = default);

    bool RequireRole(ClaimsPrincipal? principal, StaffRole requiredRole);
    bool RequireRole(ClaimsPrincipal? principal, params StaffRole[] requiredRoles);
    bool RequireRole(SessionToken? session, StaffRole requiredRole);
    bool RequireRole(string? token, StaffRole requiredRole);
}