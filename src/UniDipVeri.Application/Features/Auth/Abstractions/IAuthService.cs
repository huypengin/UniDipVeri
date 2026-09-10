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

    Task RequestPasswordResetAsync(string email, CancellationToken ct = default);
    Task<(bool IsSuccess, string? Error)> ConfirmPasswordResetAsync(string token, string newPassword, CancellationToken ct = default);
    Task<(bool IsSuccess, string? Error, string? NewSecurityStamp)> ChangePasswordAsync(Guid userId, string userType, string currentPassword, string newPassword, CancellationToken ct = default);
    Task<UserProfileResponse?> GetUserProfileAsync(Guid userId, string userType, CancellationToken ct = default);
    Task<bool> ValidateSecurityStampAsync(Guid userId, string userType, string securityStamp, CancellationToken ct = default);
}