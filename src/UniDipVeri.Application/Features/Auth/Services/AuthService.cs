using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using UniDipVeri.Application.Abstractions.Communication;
using UniDipVeri.Application.Abstractions.Repositories;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Features.Auth.Abstractions;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Features.Auth.Services;

public sealed class AuthService(
    IStaffRepository staffRepository,
    IStudentRepository studentRepository,
    IPasswordResetTokenRepository tokenRepository,
    IPasswordHasher passwordHasher,
    IEmailSender emailSender) : IAuthService
{
    private readonly IStaffRepository _staffRepository = staffRepository;
    private readonly IStudentRepository _studentRepository = studentRepository;
    private readonly IPasswordResetTokenRepository _tokenRepository = tokenRepository;
    private readonly IPasswordHasher _passwordHasher = passwordHasher;
    private readonly IEmailSender _emailSender = emailSender;

    public async Task<AuthResult> AuthenticateStaffAsync(string email, string password, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            return AuthResult.Failure("Invalid email or password.");
        }

        var staff = await _staffRepository.GetByEmailAsync(email, ct);
        if (staff is not null)
        {
            if (!staff.IsActive() || !_passwordHasher.VerifyPassword(password, staff.PasswordHash))
            {
                return AuthResult.Failure("Invalid email or password.");
            }

            var roles = staff.Roles.Select(r => r.ToString()).ToList();
            var userInfo = new AuthUserInfo(
                staff.Id,
                staff.Email,
                roles,
                "staff",
                name: staff.Name,
                securityStamp: staff.SecurityStamp);
            return AuthResult.Success(userInfo);
        }

        return AuthResult.Failure("Invalid email or password.");
    }

    public async Task<AuthResult> AuthenticateStudentAsync(string email, string password, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            return AuthResult.Failure("Invalid email or password.");
        }

        var student = await _studentRepository.GetByEmailAsync(email, ct);
        if (student is not null)
        {
            if (!student.IsAccountActive() || !_passwordHasher.VerifyPassword(password, student.PasswordHash))
            {
                return AuthResult.Failure("Invalid email or password.");
            }

            var userInfo = new AuthUserInfo(
                student.Id,
                student.Email,
                "STUDENT",
                "student",
                student.StudentNumber,
                securityStamp: student.SecurityStamp,
                name: student.Name);
            return AuthResult.Success(userInfo);
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

    public async Task RequestPasswordResetAsync(string email, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return;
        }

        var normalizedEmail = email.Trim().ToLowerInvariant();

        var staff = await _staffRepository.GetByEmailAsync(normalizedEmail, ct);
        var student = await _studentRepository.GetByEmailAsync(normalizedEmail, ct);

        // Anti-enumeration: Return silently if neither exists or if account is inactive
        if (staff is null && student is null)
        {
            return;
        }

        string userType = staff is not null ? "staff" : "student";
        string recipientName = staff?.Name ?? student!.Name;

        var tokenBytes = RandomNumberGenerator.GetBytes(32);
        var token = Convert.ToHexString(tokenBytes).ToLowerInvariant();

        var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        var tokenHash = Convert.ToHexString(hashBytes).ToLowerInvariant();

        await _tokenRepository.InvalidateExistingTokensForEmailAsync(normalizedEmail, ct);

        var resetToken = PasswordResetToken.Create(normalizedEmail, userType, tokenHash, TimeSpan.FromMinutes(15));
        await _tokenRepository.AddAsync(resetToken, ct);

        await _emailSender.SendPasswordResetEmailAsync(normalizedEmail, recipientName, token, ct);
    }

    public async Task<(bool IsSuccess, string? Error)> ConfirmPasswordResetAsync(string token, string newPassword, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return (false, "Reset token is required.");
        }

        if (!ValidatePasswordComplexity(newPassword, out var passwordError))
        {
            return (false, passwordError);
        }

        var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(token.Trim()));
        var tokenHash = Convert.ToHexString(hashBytes).ToLowerInvariant();

        var resetToken = await _tokenRepository.GetValidTokenByHashAsync(tokenHash, ct);
        if (resetToken is null || !resetToken.IsValid())
        {
            return (false, "Invalid or expired reset token.");
        }

        var newPasswordHash = _passwordHasher.HashPassword(newPassword);

        if (resetToken.UserType == "student")
        {
            var student = await _studentRepository.GetByEmailAsync(resetToken.Email, ct);
            if (student is null)
            {
                return (false, "Account not found.");
            }

            student.SetPassword(newPasswordHash);
            if (student.AccountStatus == StudentAccountStatus.PENDING_ACTIVATION)
            {
                student.ActivateAccount();
            }

            await _studentRepository.UpdateAsync(student, ct);
        }
        else
        {
            var staff = await _staffRepository.GetByEmailAsync(resetToken.Email, ct);
            if (staff is null)
            {
                return (false, "Account not found.");
            }

            staff.SetPassword(newPasswordHash);
            await _staffRepository.UpdateAsync(staff, ct);
        }

        resetToken.MarkAsUsed();
        await _tokenRepository.UpdateAsync(resetToken, ct);

        return (true, null);
    }

    public async Task<(bool IsSuccess, string? Error, string? NewSecurityStamp)> ChangePasswordAsync(
        Guid userId,
        string userType,
        string currentPassword,
        string newPassword,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(currentPassword))
        {
            return (false, "Current password is required.", null);
        }

        if (!ValidatePasswordComplexity(newPassword, out var error))
        {
            return (false, error, null);
        }

        if (string.Equals(userType, "staff", StringComparison.OrdinalIgnoreCase))
        {
            var staff = await _staffRepository.GetByIdAsync(userId, ct);
            if (staff is null || !staff.IsActive())
            {
                return (false, "Account not found or inactive.", null);
            }

            if (!_passwordHasher.VerifyPassword(currentPassword, staff.PasswordHash))
            {
                return (false, "Current password is incorrect.", null);
            }

            var hash = _passwordHasher.HashPassword(newPassword);
            staff.SetPassword(hash);
            await _staffRepository.UpdateAsync(staff, ct);

            return (true, null, staff.SecurityStamp);
        }

        if (string.Equals(userType, "student", StringComparison.OrdinalIgnoreCase))
        {
            var student = await _studentRepository.GetByIdAsync(userId, ct);
            if (student is null || !student.IsAccountActive())
            {
                return (false, "Account not found or inactive.", null);
            }

            if (!_passwordHasher.VerifyPassword(currentPassword, student.PasswordHash))
            {
                return (false, "Current password is incorrect.", null);
            }

            var hash = _passwordHasher.HashPassword(newPassword);
            student.SetPassword(hash);
            await _studentRepository.UpdateAsync(student, ct);

            return (true, null, student.SecurityStamp);
        }

        return (false, "Invalid user type.", null);
    }

    public async Task<UserProfileResponse?> GetUserProfileAsync(Guid userId, string userType, CancellationToken ct = default)
    {
        if (string.Equals(userType, "staff", StringComparison.OrdinalIgnoreCase))
        {
            var staff = await _staffRepository.GetByIdAsync(userId, ct);
            if (staff is null)
            {
                return null;
            }

            var uniName = staff.University?.Name ?? "Mekong International University";
            return new UserProfileResponse(
                staff.Id,
                staff.Email,
                staff.Name,
                staff.Role.ToString(),
                staff.Roles.Select(r => r.ToString()).ToList(),
                "staff",
                null,
                uniName);
        }

        if (string.Equals(userType, "student", StringComparison.OrdinalIgnoreCase))
        {
            var student = await _studentRepository.GetByIdAsync(userId, ct);
            if (student is null)
            {
                return null;
            }

            return new UserProfileResponse(
                student.Id,
                student.Email,
                student.Name,
                "STUDENT",
                ["STUDENT"],
                "student",
                student.StudentNumber,
                "Mekong International University");
        }

        return null;
    }

    public async Task<bool> ValidateSecurityStampAsync(Guid userId, string userType, string securityStamp, CancellationToken ct = default)
    {
        if (userId == Guid.Empty || string.IsNullOrWhiteSpace(securityStamp))
        {
            return false;
        }

        if (string.Equals(userType, "staff", StringComparison.OrdinalIgnoreCase))
        {
            var staff = await _staffRepository.GetByIdAsync(userId, ct);
            return staff is not null && staff.IsActive() && string.Equals(staff.SecurityStamp, securityStamp, StringComparison.Ordinal);
        }

        if (string.Equals(userType, "student", StringComparison.OrdinalIgnoreCase))
        {
            var student = await _studentRepository.GetByIdAsync(userId, ct);
            return student is not null && student.IsAccountActive() && string.Equals(student.SecurityStamp, securityStamp, StringComparison.Ordinal);
        }

        return false;
    }

    public static bool ValidatePasswordComplexity(string password, out string? error)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < 8)
        {
            error = "Password must be at least 8 characters long.";
            return false;
        }

        var hasLetter = password.Any(char.IsLetter);
        var hasDigitOrSpecial = password.Any(c => char.IsDigit(c) || !char.IsLetterOrDigit(c));

        if (!hasLetter || !hasDigitOrSpecial)
        {
            error = "Password must contain at least one letter and at least one number or special character.";
            return false;
        }

        error = null;
        return true;
    }
}
