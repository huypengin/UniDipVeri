using System.Security.Claims;
using UniDipVeri.Application.Abstractions.Models;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Abstractions.Services;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Features.Auth.Services;

public sealed class AuthService(
    IStaffRepository staffRepository,
    IStudentRepository studentRepository,
    IPasswordHasher passwordHasher,
    ISessionIssuer sessionIssuer) : IAuthService
{
    private readonly IStaffRepository _staffRepository = staffRepository;
    private readonly IStudentRepository _studentRepository = studentRepository;
    private readonly IPasswordHasher _passwordHasher = passwordHasher;
    private readonly ISessionIssuer _sessionIssuer = sessionIssuer;

    public async Task<AuthResult> AuthenticateStaffAsync(string email, string password, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            return AuthResult.Failure("Invalid email or password.");
        }

        // Attempt to authenticate as Staff (includes Admins, Registrars, Approvers)
        var staff = await _staffRepository.GetByEmailAsync(email, ct);
        if (staff is not null)
        {
            if (!staff.IsActive() || !_passwordHasher.VerifyPassword(password, staff.PasswordHash))
            {
                return AuthResult.Failure("Invalid email or password.");
            }

            var token = _sessionIssuer.IssueStaffSession(staff.Id, staff.Role.ToString());
            return AuthResult.Success(token);
        }

        return AuthResult.Failure("Invalid email or password.");
    }

    public async Task<AuthResult> AuthenticateStudentAsync(string email, string password, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            return AuthResult.Failure("Invalid email or password.");
        }

        // Attempt to authenticate as Student
        var student = await _studentRepository.GetByEmailAsync(email, ct);
        if (student is not null)
        {
            if (!student.IsAccountActive() || !_passwordHasher.VerifyPassword(password, student.PasswordHash))
            {
                return AuthResult.Failure("Invalid email or password.");
            }

            var token = _sessionIssuer.IssueStudentSession(student.Id, student.StudentNumber);
            return AuthResult.Success(token);
        }

        return AuthResult.Failure("Invalid email or password.");
    }

    public bool RequireRole(ClaimsPrincipal? principal, StaffRole requiredRole)
    {
        return RequireRole(principal, [requiredRole]);
    }

    public bool RequireRole(ClaimsPrincipal? principal, params StaffRole[] requiredRoles)
    {
        if (principal?.Identity is null || !principal.Identity.IsAuthenticated || requiredRoles is null || requiredRoles.Length == 0)
        {
            return false;
        }

        var userType = principal.FindFirst("user_type")?.Value;
        if (string.Equals(userType, "student", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var userRoles = principal.FindAll(c => c.Type == ClaimTypes.Role || c.Type == "role")
            .Select(c => c.Value)
            .ToList();

        return requiredRoles.Any(r =>
            principal.IsInRole(r.ToString()) ||
            userRoles.Any(ur => string.Equals(ur, r.ToString(), StringComparison.OrdinalIgnoreCase)));
    }

    public bool RequireRole(SessionToken? session, StaffRole requiredRole)
    {
        return RequireRole(session?.Value, requiredRole);
    }

    public bool RequireRole(string? token, StaffRole requiredRole)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return false;
        }

        var principal = _sessionIssuer.ValidateToken(token);
        return RequireRole(principal, requiredRole);
    }
}
