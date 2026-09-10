using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;
using UniDipVeri.Infrastructure.Persistence;
using DomainProgram = UniDipVeri.Domain.Entities.Program;

namespace UniDipVeri.IntegrationTests;

[Collection("PostgreSqlIntegrationCollection")]
public class PasswordResetAndAccountManagementIntegrationTests : IDisposable
{
    private readonly PostgreSqlTestFixture _fixture;
    private readonly HttpClient _client;
    private readonly IServiceScope _scope;
    private readonly UniDipVeriDbContext _dbContext;
    private readonly IPasswordHasher _passwordHasher;

    private readonly Guid _universityId = Guid.NewGuid();
    private readonly Guid _programId = Guid.NewGuid();
    private readonly string _staffEmail;
    private readonly string _staffPassword = "SecureStaffPassword123!";
    private readonly string _pendingStudentEmail;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public PasswordResetAndAccountManagementIntegrationTests(PostgreSqlTestFixture fixture)
    {
        _fixture = fixture;
        _client = fixture.Factory.CreateClient();
        _scope = fixture.Factory.Services.CreateScope();
        _dbContext = _scope.ServiceProvider.GetRequiredService<UniDipVeriDbContext>();
        _passwordHasher = _scope.ServiceProvider.GetRequiredService<IPasswordHasher>();

        var uniqueSuffix = Guid.NewGuid().ToString("N")[..8];
        _staffEmail = $"staff_{uniqueSuffix}@university.edu";
        _pendingStudentEmail = $"pending_{uniqueSuffix}@university.edu";

        SeedTestData(uniqueSuffix);
    }

    private void SeedTestData(string uniqueSuffix)
    {
        var universityCode = "TU" + uniqueSuffix.ToUpperInvariant();
        var university = University.Create($"Test University {uniqueSuffix}", universityCode, $"{uniqueSuffix}.tu.edu", id: _universityId);
        _dbContext.Universities.Add(university);

        var program = DomainProgram.Create(_universityId, $"Computer Science {uniqueSuffix}", "B.S. in Computer Science", DegreeLevel.BACHELOR, id: _programId);
        _dbContext.Programs.Add(program);

        var staffHash = _passwordHasher.HashPassword(_staffPassword);
        var staff = UniversityStaff.Create(_universityId, "Test Admin", _staffEmail, staffHash, StaffRole.ADMIN);
        _dbContext.UniversityStaff.Add(staff);

        var studentNumber = "STU" + uniqueSuffix.ToUpperInvariant();
        var pendingStudent = Student.Create(_programId, studentNumber, "Pending Student", _pendingStudentEmail, $"REF-{studentNumber}");
        _dbContext.Students.Add(pendingStudent);

        _dbContext.SaveChanges();
    }

    [Fact]
    public async Task ResetPasswordFlow_ShouldActivatePendingStudent_AndAllowLoginWithNewPassword()
    {
        // 1. Request password reset
        var resetResponse = await _client.PostAsJsonAsync("/api/auth/reset-password", new ResetPasswordRequest(_pendingStudentEmail));
        resetResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        // 2. Query token hash from database
        var tokenRecord = await _dbContext.PasswordResetTokens
            .Where(t => t.Email == _pendingStudentEmail && t.UsedAt == null)
            .OrderByDescending(t => t.CreatedAt)
            .FirstOrDefaultAsync();

        tokenRecord.Should().NotBeNull();
        tokenRecord!.UserType.Should().Be("student");

        // Simulate knowledge of the plain token that hashes to tokenRecord.TokenHash
        // Since we know the plain token in production is sent via email, in tests we can generate a test token & hash it, or verify the endpoint accepts valid hashes
        var testToken = "plain_test_token_1234567890abcdef123456";
        var testHashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(testToken));
        var testHash = Convert.ToHexString(testHashBytes).ToLowerInvariant();

        var customToken = PasswordResetToken.Create(_pendingStudentEmail, "student", testHash, TimeSpan.FromMinutes(15));
        _dbContext.PasswordResetTokens.Add(customToken);
        await _dbContext.SaveChangesAsync();

        // 3. Confirm password reset
        var newPassword = "BrandNewPassword123!";
        var confirmResponse = await _client.PostAsJsonAsync("/api/auth/reset-password/confirm", new ConfirmResetPasswordRequest(testToken, newPassword));
        confirmResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        // 4. Verify student is activated and can log in
        _dbContext.ChangeTracker.Clear();
        var updatedStudent = await _dbContext.Students.FirstAsync(s => s.Email == _pendingStudentEmail);
        updatedStudent.AccountStatus.Should().Be(StudentAccountStatus.ACTIVE);
        updatedStudent.IsAccountActive().Should().BeTrue();

        var loginResponse = await _client.PostAsJsonAsync("/api/students/login", new LoginRequest(_pendingStudentEmail, newPassword));
        loginResponse.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ChangePassword_ShouldInvalidateOtherActiveSessions()
    {
        // Arrange: Login Client 1
        var client1 = _fixture.Factory.CreateClient();
        var loginResp1 = await client1.PostAsJsonAsync("/api/staffs/login", new LoginRequest(_staffEmail, _staffPassword));
        loginResp1.StatusCode.Should().Be(HttpStatusCode.OK);

        // Login Client 2
        var client2 = _fixture.Factory.CreateClient();
        var loginResp2 = await client2.PostAsJsonAsync("/api/staffs/login", new LoginRequest(_staffEmail, _staffPassword));
        loginResp2.StatusCode.Should().Be(HttpStatusCode.OK);

        // Client 2 verifies access before password change
        var meBefore = await client2.GetAsync("/api/me");
        meBefore.StatusCode.Should().Be(HttpStatusCode.OK);

        // Act: Client 1 changes password
        var newPass = "NewSecurePassword456!";
        var changeResp = await client1.PostAsJsonAsync("/api/auth/change-password", new ChangePasswordRequest(_staffPassword, newPass));
        changeResp.StatusCode.Should().Be(HttpStatusCode.OK);

        // Assert: Client 1 session is refreshed and still valid
        var client1Me = await client1.GetAsync("/api/me");
        client1Me.StatusCode.Should().Be(HttpStatusCode.OK);

        // Assert: Client 2 session cookie had old security stamp and is now rejected
        var client2Me = await client2.GetAsync("/api/me");
        client2Me.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetMe_ShouldReturnCompleteProfile()
    {
        // Arrange
        var client = _fixture.Factory.CreateClient();
        var loginResp = await client.PostAsJsonAsync("/api/staffs/login", new LoginRequest(_staffEmail, _staffPassword));
        loginResp.StatusCode.Should().Be(HttpStatusCode.OK);

        // Act
        var meResp = await client.GetAsync("/api/me");

        // Assert
        meResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await meResp.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        json.GetProperty("email").GetString().Should().Be(_staffEmail);
        json.GetProperty("role").GetString().Should().Be("ADMIN");
        json.GetProperty("institution").GetString().Should().NotBeNullOrWhiteSpace();
    }

    public void Dispose()
    {
        _scope.Dispose();
        _client.Dispose();
    }
}
