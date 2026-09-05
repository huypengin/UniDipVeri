using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using UniDipVeri.Application.Abstractions.Models;
using UniDipVeri.Application.Abstractions.Security;

namespace UniDipVeri.Infrastructure.Security;

public sealed class JwtSessionIssuer(IOptions<JwtSettings> settings) : ISessionIssuer
{
    private readonly JwtSettings _settings = settings.Value;

    public SessionToken IssueStaffSession(Guid staffId, string role)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, staffId.ToString()),
            new Claim(ClaimTypes.Role, role), // Scoped to role (e.g., "Admin", "Staff")
            new Claim("user_type", "staff")
        };
        return GenerateToken(claims);
    }

    public SessionToken IssueStudentSession(Guid studentId, string studentNumber)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, studentId.ToString()),
            new Claim("student_id", studentNumber), // The student id provisioned by University not by UniDipVeri
            new Claim("user_type", "student")
        };
        return GenerateToken(claims);
    }

    public ClaimsPrincipal? ValidateToken(string token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return null;
        }

        var tokenHandler = new JwtSecurityTokenHandler();
        var key = Encoding.UTF8.GetBytes(_settings.SecretKey);

        var validationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(key),
            ValidateIssuer = true,
            ValidIssuer = _settings.Issuer,
            ValidateAudience = true,
            ValidAudience = _settings.Audience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero
        };

        try
        {
            return tokenHandler.ValidateToken(token, validationParameters, out _);
        }
        catch
        {
            return null;
        }
    }

    private SessionToken GenerateToken(Claim[] claims)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_settings.SecretKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var expires = DateTime.UtcNow.AddHours(_settings.ExpirationInHours);

        var token = new JwtSecurityToken(
            issuer: _settings.Issuer,
            audience: _settings.Audience,
            claims: claims,
            expires: expires,
            signingCredentials: credentials);

        return new SessionToken(
            Value: new JwtSecurityTokenHandler().WriteToken(token),
            ExpiresAt: expires);
    }
}

// Settings class (usually in appsettings.json)
public sealed class JwtSettings
{
    public string SecretKey { get; init; } = default!;
    public string Issuer { get; init; } = default!;
    public string Audience { get; init; } = default!;
    public int ExpirationInHours { get; init; } = 24;
}
