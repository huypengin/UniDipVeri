using System.Security.Claims;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Features.Auth.Abstractions;

public interface IAuthService
{
    Task<AuthResult> AuthenticateStaffAsync(string email, string password, CancellationToken ct = default);
    Task<AuthResult> AuthenticateStudentAsync(string email, string password, CancellationToken ct = default);

    bool RequireRole(ClaimsPrincipal? principal, StaffRole requiredRole);
    bool RequireRole(ClaimsPrincipal? principal, params StaffRole[] requiredRoles);
}