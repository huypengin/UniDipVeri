using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using UniDipVeri.Application.Abstractions.Models;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;
using UniDipVeri.Infrastructure.Persistence;
using Xunit;
using DomainProgram = UniDipVeri.Domain.Entities.Program;

namespace UniDipVeri.IntegrationTests;

[Collection("PostgreSqlIntegrationCollection")]
public class AuthenticationIntegrationTests : IDisposable
{
    private readonly HttpClient _client;
    private readonly IServiceScope _scope;
    private readonly UniDipVeriDbContext _dbContext;
    private readonly IPasswordHasher _passwordHasher;

    private readonly Guid _universityId = Guid.NewGuid();
    private readonly Guid _programId = Guid.NewGuid();
    private readonly string _staffEmail;
    private readonly string _staffPassword = "SecureStaffPassword123!";
    private readonly string _studentEmail;
    private readonly string _studentPassword = "SecureStudentPassword123!";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public AuthenticationIntegrationTests(PostgreSqlTestFixture fixture)
    {
        _client = fixture.Factory.CreateClient();
        _scope = fixture.Factory.Services.CreateScope();
        _dbContext = _scope.ServiceProvider.GetRequiredService<UniDipVeriDbContext>();
        _passwordHasher = _scope.ServiceProvider.GetRequiredService<IPasswordHasher>();

        var uniqueSuffix = Guid.NewGuid().ToString("N")[..8];
        _staffEmail = $"staff_{uniqueSuffix}@university.edu";
        _studentEmail = $"student_{uniqueSuffix}@university.edu";

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
        var staff = UniversityStaff.Create(_universityId, "Jane Registrar", _staffEmail, staffHash, StaffRole.REGISTRAR);
        _dbContext.UniversityStaff.Add(staff);

        var studentHash = _passwordHasher.HashPassword(_studentPassword);
        var studentNumber = "STU" + uniqueSuffix.ToUpperInvariant();
        var student = Student.Create(_programId, studentNumber, "John Doe", _studentEmail, $"REF-{studentNumber}", studentHash);
        student.ActivateAccount();
        _dbContext.Students.Add(student);

        _dbContext.SaveChanges();
    }

    [Fact]
    public async Task StaffLogin_ShouldReturn200AndValidJwt_WhenCredentialsAreValid()
    {
        // Arrange
        var request = new LoginRequest(_staffEmail, _staffPassword);

        // Act: Real HTTP POST through ASP.NET Core pipeline to StaffController -> AuthService -> PostgresStaffRepository -> PostgreSQL
        var response = await _client.PostAsJsonAsync("/api/staffs/login", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await response.Content.ReadFromJsonAsync<SessionToken>(JsonOptions);
        token.Should().NotBeNull();
        token!.Value.Should().NotBeNullOrWhiteSpace();
        token.ExpiresAt.Should().BeAfter(DateTime.UtcNow);
    }

    [Fact]
    public async Task StudentLogin_ShouldReturn200AndValidJwt_WhenCredentialsAreValid()
    {
        // Arrange
        var request = new LoginRequest(_studentEmail, _studentPassword);

        // Act: Real HTTP POST through ASP.NET Core pipeline to StudentController -> AuthService -> PostgresStudentRepository -> PostgreSQL
        var response = await _client.PostAsJsonAsync("/api/students/login", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var token = await response.Content.ReadFromJsonAsync<SessionToken>(JsonOptions);
        token.Should().NotBeNull();
        token!.Value.Should().NotBeNullOrWhiteSpace();
        token.ExpiresAt.Should().BeAfter(DateTime.UtcNow);
    }

    [Fact]
    public async Task StaffLogin_ShouldReturn401_WhenPasswordIsIncorrect()
    {
        // Arrange
        var request = new LoginRequest(_staffEmail, "WrongPassword123!");

        // Act
        var response = await _client.PostAsJsonAsync("/api/staffs/login", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task StudentLogin_ShouldReturn401_WhenPasswordIsIncorrect()
    {
        // Arrange
        var request = new LoginRequest(_studentEmail, "WrongPassword123!");

        // Act
        var response = await _client.PostAsJsonAsync("/api/students/login", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task StaffLogin_ShouldReturn401_WhenUserDoesNotExist()
    {
        // Arrange
        var request = new LoginRequest("nonexistent@university.edu", "AnyPassword123!");

        // Act
        var response = await _client.PostAsJsonAsync("/api/staffs/login", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task StudentLogin_ShouldReturn401_WhenUserDoesNotExist()
    {
        // Arrange
        var request = new LoginRequest("nonexistent.student@university.edu", "AnyPassword123!");

        // Act
        var response = await _client.PostAsJsonAsync("/api/students/login", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenRequestBodyHasEmptyFields()
    {
        // Arrange: Record DTO validation (Layer 1 defense) triggers 401 Unauthorized
        var request = new LoginRequest("", "");

        // Act
        var response = await _client.PostAsJsonAsync("/api/staffs/login", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    public void Dispose()
    {
        _scope.Dispose();
        _client.Dispose();
    }
}
